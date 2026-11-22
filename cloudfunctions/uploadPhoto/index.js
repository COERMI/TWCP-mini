// cloudfunctions/uploadPhoto/index.js —— 照片上传与归档
// 流程：校验权限 -> 下载原图 -> 获取天气/逆地理(可选) -> sharp 生成水印 -> 上传水印图
//       -> 关联运输事件(固定复用/动态新建) -> 写入 photo_records -> 更新计数
const cloud = require('wx-server-sdk');
const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 事件类型定义
const FIXED_TYPES = ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT'];
const TYPE_NAMES = {
  WAYBILL: '货运运单',
  CARGO_PHOTO: '货物照片',
  LOADED_COMPARTMENT: '装箱完成照片',
  DOOR_OPEN: '开门',
  DOOR_CLOSE: '关门',
  OTHER: '其他照片',
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 北京时间格式化
function formatBJT(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 19);
}
function weekdayCN(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return '星期' + WEEKDAYS[d.getUTCDay()];
}

function eventNameFor(type, seq) {
  if (type === 'DOOR_OPEN') return '第' + seq + '次开门';
  if (type === 'DOOR_CLOSE') return '第' + seq + '次关门';
  return TYPE_NAMES[type] || '其他照片';
}

// ==== 天气（和风天气，失败不阻断上传）====
// 优先使用 JWT 认证（官方推荐，新版 v1 接口）；未配置 JWT 时回退到 API Key（旧版 v7 接口）。

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

// 规范化私钥：兼容「多行 PEM」与「去掉换行的单行 PEM」两种粘贴方式
function normalizePrivateKey(key) {
  if (!key) return '';
  key = String(key).trim();
  if (key.indexOf('\n') >= 0) return key;
  const m = key.match(/-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=]+)-----END PRIVATE KEY-----/);
  if (m) {
    const body = m[1].replace(/(.{64})/g, '$1\n');
    return '-----BEGIN PRIVATE KEY-----\n' + body + '-----END PRIVATE KEY-----\n';
  }
  return key;
}

// 生成和风天气 JWT（Ed25519 签名，Node 内置 crypto 实现，零额外依赖）
function generateQWeatherJwt() {
  const kid = process.env.QWEATHER_KID;
  const iss = process.env.QWEATHER_ISS;
  const sub = process.env.QWEATHER_SUB;
  const privateKey = normalizePrivateKey(process.env.QWEATHER_PRIVATE_KEY);
  if (!kid || !iss || !sub || !privateKey) return null;

  const header = { alg: 'EdDSA', kid };
  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + 900; // 15 分钟（最长允许 24 小时）
  const payload = { iss, sub, iat, exp };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const data = headerB64 + '.' + payloadB64;

  const signature = crypto.sign(null, Buffer.from(data), privateKey);
  const sigB64 = base64url(signature);

  return data + '.' + sigB64;
}

async function fetchWeather(lat, lon) {
  const jwt = generateQWeatherJwt();
  const apiKey = process.env.WEATHER_KEY;

  // 方式一：JWT + 新版 v1 接口
  if (jwt) {
    const apiHost = (process.env.QWEATHER_API_HOST || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (apiHost) {
      try {
        const url = 'https://' + apiHost + '/weather/v1/current/' + lat + '/' + lon;
        const res = await axios.get(url, {
          timeout: 5000,
          headers: { Authorization: 'Bearer ' + jwt },
        });
        const d = res.data;
        if (d && d.condition && d.temperature) {
          return {
            weather: d.condition.text || '',
            temperature: d.temperature.value != null ? Number(d.temperature.value) : null,
            fetched_at: Date.now(),
          };
        }
      } catch (e) {
        // JWT 调用失败，继续尝试 API Key 方式
      }
    }
  }

  // 方式二：API Key + 旧版 v7 接口（兼容）
  if (apiKey) {
    try {
      const url = 'https://devapi.qweather.com/v7/weather/now?location=' + lon + ',' + lat + '&key=' + apiKey;
      const res = await axios.get(url, { timeout: 5000 });
      const now = res.data && res.data.now;
      if (now) {
        return {
          weather: now.text || '',
          temperature: now.temp != null ? Number(now.temp) : null,
          fetched_at: Date.now(),
        };
      }
    } catch (e) {}
  }

  return null;
}

// ==== 逆地理编码（腾讯位置服务，可选；失败不阻断）====
async function reverseGeocode(lat, lon) {
  const key = process.env.TENCENT_MAP_KEY;
  if (!key) return null;
  try {
    const url = 'https://apis.map.qq.com/ws/geocoder/v1/?location=' + lat + ',' + lon + '&key=' + key;
    const res = await axios.get(url, { timeout: 5000 });
    const r = res.data;
    if (r && r.status === 0 && r.result) {
      return r.result.address || null;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ==== 水印：SVG 文字叠加到图片右下角 ====
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 中文字体文件绝对路径（随云函数一起打包，避免云环境缺中文字体导致乱码）
const FONT_PATH = path.join(__dirname, 'fonts', 'wqy-microhei.ttc');

function buildSvg(lines) {
  const fontSize = 40;
  const lineHeight = 56;
  const padX = 28;
  const padY = 24;
  const width = 720;
  const height = padY * 2 + lines.length * lineHeight;
  let texts = '';
  lines.forEach((line, i) => {
    const y = padY + lineHeight * (i + 1) - 10;
    texts +=
      '<text x="' + padX + '" y="' + y + '" font-size="' + fontSize +
      '" fill="#ffffff" font-family="WM">' +
      escapeXml(line) + '</text>';
  });
  return (
    '<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><style>@font-face { font-family: "WM"; src: url("file://' + FONT_PATH + '"); }</style></defs>' +
    '<rect width="' + width + '" height="' + height + '" rx="12" fill="rgba(0,0,0,0.45)"/>' +
    texts + '</svg>'
  );
}

function buildWatermarkLines(ctx) {
  const lines = [];
  if (ctx.plateNumber) lines.push('车牌：' + ctx.plateNumber);
  lines.push('时间：' + formatBJT(ctx.captureTime));
  lines.push('星期：' + weekdayCN(ctx.captureTime));
  lines.push(ctx.locationText ? '地点：' + ctx.locationText : '地点：定位未获取');
  if (ctx.weather) {
    lines.push('天气：' + ctx.weather + (ctx.temperature != null ? ' ' + ctx.temperature + '℃' : ''));
  } else {
    lines.push('天气：暂不可用');
  }
  lines.push('档案编号：' + ctx.recordNo);
  lines.push('事件：' + ctx.eventName);
  return lines;
}

async function makeWatermark(inputBuffer, lines) {
  const svg = buildSvg(lines);
  return sharp(inputBuffer)
    .rotate() // 依 EXIF 自动旋转
    .resize({ width: 1600, withoutEnlargement: true })
    .composite([{ input: Buffer.from(svg), gravity: 'southeast' }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ==== 事件：固定节点复用已有事件；动态事件每次新建 ====
async function getOrCreateEvent(recordId, eventType, remark) {
  const eventsCol = db.collection('transport_events');

  if (FIXED_TYPES.indexOf(eventType) >= 0) {
    const res = await eventsCol
      .where({ record_id: recordId, event_type: eventType })
      .limit(1)
      .get();
    if (res.data.length > 0) {
      const e = res.data[0];
      return { _id: e._id, event_no: e.event_no, event_type: e.event_type, event_name: e.event_name, isNew: false };
    }
    return createEvent(recordId, eventType, remark, 1, true);
  }

  // 动态事件：序号递增
  const countRes = await eventsCol.where({ record_id: recordId, event_type: eventType }).count();
  const seq = countRes.total + 1;
  return createEvent(recordId, eventType, remark, seq, true);
}

async function createEvent(recordId, eventType, remark, seq, isNew) {
  const eventName = eventNameFor(eventType, seq);
  const res = await db.collection('transport_events').add({
    data: {
      record_id: recordId,
      event_no: seq,
      event_type: eventType,
      event_name: eventName,
      remark: remark || '',
      photo_count: 0,
      created_at: db.serverDate(),
      updated_at: db.serverDate(),
    },
  });
  return { _id: res._id, event_no: seq, event_type: eventType, event_name: eventName, isNew };
}

async function uploadBuffer(buffer, recordNo, suffix) {
  const cloudPath =
    'transport-records/' + recordNo + '/' + Date.now() + '-' + suffix + '-' +
    Math.floor(Math.random() * 100000) + '.jpg';
  const res = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  return res.fileID;
}

exports.main = async (event) => {
  const recordNo = (event.record_no || '').trim();
  const accessToken = (event.access_token || '').trim();
  const eventType = event.event_type;
  const fileID = event.file_id;

  if (!recordNo || !eventType || !fileID) {
    return { success: false, code: 'INVALID', message: '参数不完整' };
  }
  if (!TYPE_NAMES[eventType]) {
    return { success: false, code: 'INVALID_TYPE', message: '未知事件类型' };
  }

  try {
    // 1. 查档案并校验令牌
    const recRes = await db
      .collection('transport_records')
      .where({ record_no: recordNo })
      .limit(1)
      .get();
    if (recRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', message: '档案不存在' };
    }
    const record = recRes.data[0];
    if (record.access_token && accessToken !== record.access_token) {
      return { success: false, code: 'FORBIDDEN', message: '无权操作该档案' };
    }

    // 2. 下载原图
    let originalBuffer;
    try {
      const dl = await cloud.downloadFile({ fileID });
      originalBuffer = dl.fileContent;
    } catch (e) {
      return { success: false, code: 'DOWNLOAD_FAIL', message: '图片下载失败' };
    }

    // 3. 时间与定位
    const captureTime = Number(event.device_capture_time) || Date.now();
    const lat = typeof event.latitude === 'number' ? event.latitude : null;
    const lon = typeof event.longitude === 'number' ? event.longitude : null;

    // 4. 天气 + 逆地理（并行，失败均不阻断）
    const [weather, locationText] = await Promise.all([
      lat != null && lon != null ? fetchWeather(lat, lon).catch(() => null) : Promise.resolve(null),
      lat != null && lon != null ? reverseGeocode(lat, lon).catch(() => null) : Promise.resolve(null),
    ]);

    // 5. 事件：固定复用 / 动态新建
    const evt = await getOrCreateEvent(record._id, eventType, event.remark || '');

    // 6. 生成水印图
    const lines = buildWatermarkLines({
      plateNumber: record.plate_number,
      captureTime,
      locationText,
      weather: weather ? weather.weather : null,
      temperature: weather ? weather.temperature : null,
      recordNo: record.record_no,
      eventName: evt.event_name,
    });
    let watermarkedBuffer;
    try {
      watermarkedBuffer = await makeWatermark(originalBuffer, lines);
    } catch (e) {
      // 水印生成失败时，回退为原图（不阻断上传）
      watermarkedBuffer = originalBuffer;
    }
    const watermarkedFileID = await uploadBuffer(watermarkedBuffer, record.record_no, 'wm');

    // 7. 写入照片记录
    const photoRes = await db.collection('photo_records').add({
      data: {
        record_id: record._id,
        event_id: evt._id,
        original_url: fileID,
        watermarked_url: watermarkedFileID,
        device_capture_time: new Date(captureTime),
        server_received_at: db.serverDate(),
        latitude: lat,
        longitude: lon,
        location_text: locationText || null,
        location_accuracy: typeof event.accuracy === 'number' ? event.accuracy : null,
        weather: weather ? weather.weather : null,
        temperature: weather ? weather.temperature : null,
        weather_fetched_at: weather ? new Date(weather.fetched_at) : null,
        upload_status: 'success',
        is_appended: record.status === 'submitted',
        created_at: db.serverDate(),
      },
    });

    // 8. 更新事件与档案计数
    await db.collection('transport_events').doc(evt._id).update({
      data: { photo_count: _.inc(1), updated_at: db.serverDate() },
    });

    const recordUpdate = {
      updated_at: db.serverDate(),
      photo_count: _.inc(1),
    };
    if (evt.isNew) {
      recordUpdate.event_count = _.inc(1);
    }
    await db.collection('transport_records').doc(record._id).update({ data: recordUpdate });

    return {
      success: true,
      data: {
        photo_id: photoRes._id,
        event: { event_no: evt.event_no, event_type: evt.event_type, event_name: evt.event_name },
      },
    };
  } catch (e) {
    console.error('uploadPhoto error:', e);
    return { success: false, code: 'INTERNAL', message: '照片归档失败，请重试' };
  }
};
