// cloudfunctions/getRecordAdmin/index.js —— 后台档案详情
// 职责：管理员 token 校验 -> 查档案 + 事件 + 照片 -> 云存储 fileID 批量转临时 URL
const cloud = require('wx-server-sdk');
const { verifyToken } = require('./auth');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 把云存储 fileID 批量转换为带有效期的临时 HTTPS 链接（每次最多 50 个，分多批）
async function getTempUrls(fileIds) {
  const urlMap = {};
  const unique = Array.from(new Set(fileIds.filter(Boolean)));
  const batchSize = 50;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    try {
      const res = await cloud.getTempFileURL({ fileList: batch });
      (res.fileList || []).forEach((f) => {
        urlMap[f.fileID] = f.tempFileURL || '';
      });
    } catch (e) {
      // 单个批次失败不阻断整体，链接留空由前端兜底
    }
  }
  return urlMap;
}

exports.main = async (event) => {
  const token = (event.token || '').trim();
  if (!verifyToken(token)) {
    return { success: false, code: 'FORBIDDEN', message: '登录已失效，请重新登录' };
  }

  const recordNo = (event.record_no || '').trim();
  if (!recordNo) {
    return { success: false, code: 'INVALID', message: '缺少档案编号' };
  }

  try {
    const recRes = await db
      .collection('transport_records')
      .where({ record_no: recordNo })
      .limit(1)
      .get();
    if (recRes.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', message: '档案不存在' };
    }
    const record = recRes.data[0];

    const evRes = await db
      .collection('transport_events')
      .where({ record_id: record._id })
      .orderBy('event_no', 'asc')
      .limit(1000)
      .get();

    const phRes = await db
      .collection('photo_records')
      .where({ record_id: record._id })
      .orderBy('created_at', 'asc')
      .limit(1000)
      .get();

    // 收集所有需要转换的 fileID（原图 + 水印图）
    const fileIds = [];
    phRes.data.forEach((p) => {
      if (p.watermarked_url) fileIds.push(p.watermarked_url);
      if (p.original_url) fileIds.push(p.original_url);
    });
    const urlMap = await getTempUrls(fileIds);

    // 照片按事件分组
    const photoByEvent = {};
    phRes.data.forEach((p) => {
      if (!photoByEvent[p.event_id]) photoByEvent[p.event_id] = [];
      photoByEvent[p.event_id].push({
        id: p._id,
        watermarked_url: urlMap[p.watermarked_url] || '',
        original_url: urlMap[p.original_url] || '',
        device_capture_time: p.device_capture_time || null,
        server_received_at: p.server_received_at || null,
        latitude: p.latitude != null ? p.latitude : null,
        longitude: p.longitude != null ? p.longitude : null,
        location_text: p.location_text || '',
        location_accuracy: p.location_accuracy != null ? p.location_accuracy : null,
        weather: p.weather || '',
        temperature: p.temperature != null ? p.temperature : null,
        weather_fetched_at: p.weather_fetched_at || null,
        upload_status: p.upload_status || 'success',
        is_appended: !!p.is_appended,
        created_at: p.created_at,
      });
    });

    const events = evRes.data.map((e) => ({
      id: e._id,
      event_no: e.event_no,
      event_type: e.event_type,
      event_name: e.event_name,
      remark: e.remark || '',
      photo_count: e.photo_count || 0,
      created_at: e.created_at,
      photos: photoByEvent[e._id] || [],
    }));

    return {
      success: true,
      data: {
        record: {
          id: record._id,
          record_no: record.record_no,
          plate_number: record.plate_number,
          status: record.status,
          created_at: record.created_at,
          updated_at: record.updated_at,
          submitted_at: record.submitted_at || null,
          photo_count: record.photo_count || 0,
          event_count: record.event_count || 0,
        },
        events,
      },
    };
  } catch (e) {
    return { success: false, code: 'DB_ERROR', message: '查询失败，请重试' };
  }
};
