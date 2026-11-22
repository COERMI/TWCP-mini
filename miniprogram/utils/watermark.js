// utils/watermark.js —— 客户端水印：文本组装 + canvas 绘制
//
// 背景：云函数上传时用服务端图像库生成水印，会在云开发环境初始化阶段崩溃，
//       因此水印改在小程序端用 canvas 2d 绘制，上传已带水印的图片。
// 说明：本文件中的 buildLines / eventNameFor 为纯函数（不依赖 wx），
//       可在 node 环境下直接 require 做单元校验；drawToCanvas 依赖 wx.canvas。
const config = require('../config');

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const EVENT_TYPES = (config && config.EVENT_TYPES) ? config.EVENT_TYPES : {};

/** 目标宽度上限（与原服务端 .resize({ width: 1600, withoutEnlargement: true }) 一致） */
const MAX_WIDTH = 1600;

/** 字号下限：极端长文本时最多缩到这里，再超才允许裁切并 console.warn */
const MIN_FONT_SIZE = 16;

/**
 * 数字补零到两位
 * @param {number} n 数字
 * @returns {string} 两位字符串
 */
function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/**
 * 毫秒时间戳 -> 北京时间字符串（YYYY-MM-DD HH:mm:ss）
 * 与云函数原 formatBJT 逻辑完全一致（+8 小时），保证客户端/服务端文案相同。
 * @param {number} ts 毫秒时间戳
 * @returns {string} 形如 2026-11-21 08:05:03
 */
function formatBJT(ts) {
  const value = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
  const d = new Date(value + 8 * 3600 * 1000);
  const iso = d.toISOString();
  return iso.slice(0, 10) + ' ' + iso.slice(11, 19);
}

/**
 * 毫秒时间戳 -> 中文星期
 * @param {number} ts 毫秒时间戳
 * @returns {string} 形如 星期六
 */
function weekdayCN(ts) {
  const value = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
  const d = new Date(value + 8 * 3600 * 1000);
  return '星期' + WEEKDAYS[d.getUTCDay()];
}

/**
 * 判断值是否为空（null / undefined / 空白字符串）
 * 用途：`Number(null) === 0`，坐标与温度必须先判空再转数字，否则会画出「0.000000,0.000000」「0℃」。
 * 注意：数字 0 是合法值（赤道/本初子午线/0℃），不算空。
 * @param {*} value 待判断值
 * @returns {boolean} 是否为空
 */
function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/**
 * 经纬度兜底文案：纬度,经度（各保留 6 位小数）
 * @param {number} latitude 纬度
 * @param {number} longitude 经度
 * @returns {string} 形如 31.230416,121.473701；无坐标时返回空串
 */
function formatLatLng(latitude, longitude) {
  // 先判空：无定位时（用户拒绝授权/室内无信号）不能返回 "0.000000,0.000000"
  if (isBlank(latitude) || isBlank(longitude)) return '';
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!isFinite(lat) || !isFinite(lng)) return '';
  return lat.toFixed(6) + ',' + lng.toFixed(6);
}

/**
 * 地点文案：优先逆地理地址，其次经纬度，最后「定位未获取」
 * @param {string} locationText 逆地理地址
 * @param {number} latitude 纬度
 * @param {number} longitude 经度
 * @returns {string} 地点文案
 */
function resolveLocationText(locationText, latitude, longitude) {
  const text = typeof locationText === 'string' ? locationText.trim() : '';
  if (text) return text;
  const latLng = formatLatLng(latitude, longitude);
  if (latLng) return latLng;
  return '定位未获取';
}

/**
 * 天气文案：有天气时拼接温度，否则「暂不可用」
 * @param {string} weather 天气状况，如 晴
 * @param {number} temperature 温度（摄氏度）
 * @returns {string} 形如 晴 12℃ / 晴 / 暂不可用
 */
function resolveWeatherText(weather, temperature) {
  const text = typeof weather === 'string' ? weather.trim() : '';
  if (!text) return '暂不可用';
  // 先判空：温度缺失时不能显示「晴 0℃」（Number(null) === 0）
  if (isBlank(temperature)) return text;
  const temp = Number(temperature);
  if (isFinite(temp)) return text + ' ' + temp + '℃';
  return text;
}

/**
 * 组装水印文案（顺序固定，共 7 行，车牌缺失时 6 行）
 * @param {object} ctx 上下文
 * @param {string} [ctx.plateNumber] 车牌号
 * @param {number} [ctx.captureTime] 拍摄时刻（毫秒时间戳）
 * @param {string} [ctx.locationText] 逆地理地址
 * @param {number} [ctx.latitude] 纬度
 * @param {number} [ctx.longitude] 经度
 * @param {string} [ctx.weather] 天气状况
 * @param {number} [ctx.temperature] 温度
 * @param {string} [ctx.recordNo] 档案编号
 * @param {string} [ctx.eventName] 事件名称
 * @returns {string[]} 水印文本行
 */
function buildLines(ctx) {
  const source = ctx || {};
  const lines = [];

  const plateNumber = typeof source.plateNumber === 'string' ? source.plateNumber.trim() : '';
  if (plateNumber) lines.push('车牌：' + plateNumber);

  lines.push('时间：' + formatBJT(source.captureTime));
  lines.push('星期：' + weekdayCN(source.captureTime));
  lines.push('地点：' + resolveLocationText(source.locationText, source.latitude, source.longitude));
  lines.push('天气：' + resolveWeatherText(source.weather, source.temperature));

  const recordNo = typeof source.recordNo === 'string' ? source.recordNo.trim() : '';
  lines.push('档案编号：' + recordNo);

  const eventName = typeof source.eventName === 'string' ? source.eventName.trim() : '';
  lines.push('事件：' + eventName);

  return lines;
}

/**
 * 归一化事件序号：支持直接传数字，或传事件计数对象（key 为事件类型）
 * @param {number|object} counts 序号，或 { DOOR_OPEN: 2 } 形式
 * @param {string} eventType 事件类型
 * @returns {number} 序号（>= 1）
 */
function normalizeSeq(counts, eventType) {
  let seq = 1;
  if (typeof counts === 'number' && isFinite(counts)) {
    seq = counts;
  } else if (counts && typeof counts === 'object') {
    const byType = counts[eventType];
    if (typeof byType === 'number' && isFinite(byType)) {
      seq = byType;
    } else if (typeof counts.current === 'number' && isFinite(counts.current)) {
      seq = counts.current;
    }
  }
  seq = Math.floor(seq);
  if (!(seq >= 1)) seq = 1;
  return seq;
}

/**
 * 事件显示名：动态事件带次数，固定事件取配置名
 * 注意：DOOR_OPEN / DOOR_CLOSE 的 counts 需传「本次将要写入的序号」，
 *       即调用方按「当前已有次数 + 1」估算后传入。
 * @param {string} eventType 事件类型
 * @param {number|object} counts 本次序号，或事件计数对象
 * @returns {string} 事件名称
 */
function eventNameFor(eventType, counts) {
  if (eventType === 'DOOR_OPEN') return '第' + normalizeSeq(counts, eventType) + '次开门';
  if (eventType === 'DOOR_CLOSE') return '第' + normalizeSeq(counts, eventType) + '次关门';
  const def = EVENT_TYPES[eventType];
  if (def && def.name) return def.name;
  return '其他照片';
}

/**
 * 绘制圆角矩形路径
 * @param {CanvasRenderingContext2D} ctx canvas 2d 上下文
 * @param {number} x 左上角 x
 * @param {number} y 左上角 y
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} r 圆角半径
 * @returns {void}
 */
function roundRectPath(ctx, x, y, w, h, r) {
  let radius = r;
  const maxRadius = Math.min(w, h) / 2;
  if (!(radius > 0)) radius = 0;
  if (radius > maxRadius) radius = maxRadius;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * 计算水印排版（纯函数，便于单测：measure 由调用方注入，不依赖 canvas）
 *
 * 字号策略：以 width/40 为上界（图宽自适应），若最长行超出可用宽度则按比例收缩，
 * 最多迭代 2 轮；下限 MIN_FONT_SIZE。缩到下限仍超宽时返回 overflows=true，由调用方 warn。
 * 行高、内边距、底色盒均随最终字号重算，避免新旧字号混用。
 *
 * @param {object} options 参数
 * @param {number} options.width 画布宽（像素）
 * @param {number} options.height 画布高（像素）
 * @param {string[]} options.lines 水印文本行
 * @param {function(string, number): number} [options.measure] 文本测量函数 (text, fontSize) => width
 * @returns {object} 排版结果（fontSize / lineHeight / padding / boxX / boxY / boxW / boxH / overflows 等）
 */
function computeLayout(options) {
  const opts = options || {};
  const width = Math.max(1, Math.floor(Number(opts.width) || 1));
  const height = Math.max(1, Math.floor(Number(opts.height) || 1));
  const lines = Array.isArray(opts.lines) ? opts.lines : [];
  const measure = typeof opts.measure === 'function' ? opts.measure : null;

  const margin = width * 0.02;
  const maxFontSize = Math.max(Math.round(width / 40), 20);

  /**
   * 在指定字号下量出最长行
   * @param {number} size 字号
   * @returns {{width:number, text:string}} 最长行宽度与内容
   */
  const measureLongest = (size) => {
    let longest = 0;
    let longestText = '';
    for (let i = 0; i < lines.length; i += 1) {
      const w = measure ? Number(measure(lines[i], size)) || 0 : 0;
      if (w > longest) {
        longest = w;
        longestText = lines[i];
      }
    }
    return { width: longest, text: longestText };
  };

  // 按最长行自适应收缩（最多 2 轮，避免浮点来回）
  let fontSize = maxFontSize;
  for (let round = 0; round < 2; round += 1) {
    const roundPadding = fontSize * 0.7;
    const roundAvail = Math.max(1, width - margin * 2 - roundPadding * 2);
    const measured = measureLongest(fontSize);
    if (measured.width <= roundAvail) break;

    const scaled = Math.floor((fontSize * roundAvail) / measured.width);
    const next = Math.max(MIN_FONT_SIZE, scaled);
    if (next >= fontSize) {
      // 已到下限（或比例收缩无效），停止迭代
      fontSize = MIN_FONT_SIZE;
      break;
    }
    fontSize = next;
  }

  const padding = fontSize * 0.7;
  const lineHeight = fontSize * 1.4;
  const availWidth = Math.max(1, width - margin * 2 - padding * 2);
  const finalMeasured = measureLongest(fontSize);
  const textWidth = finalMeasured.width;

  let boxW = textWidth + padding * 2;
  let boxH = lines.length * lineHeight + padding * 2;
  // 极端小图保护：底色不超出画布
  if (boxW > width) boxW = width;
  if (boxH > height) boxH = height;

  let boxX = width - margin - boxW;
  let boxY = height - margin - boxH;
  if (boxX < 0) boxX = 0;
  if (boxY < 0) boxY = 0;

  return {
    width: width,
    height: height,
    fontSize: fontSize,
    lineHeight: lineHeight,
    padding: padding,
    margin: margin,
    maxFontSize: maxFontSize,
    minFontSize: MIN_FONT_SIZE,
    textWidth: textWidth,
    availWidth: availWidth,
    boxW: boxW,
    boxH: boxH,
    boxX: boxX,
    boxY: boxY,
    radius: Math.min(fontSize * 0.3, boxH / 2),
    overflows: textWidth > availWidth + 0.5,
    longestLine: finalMeasured.text,
  };
}

/**
 * 在 canvas 上绘制「图片 + 右下角水印文字」并导出临时文件
 * @param {object} options 参数
 * @param {object} options.canvas canvas 2d 节点（selectorQuery 拿到的 node）
 * @param {string} options.imagePath 原图临时路径
 * @param {string[]} options.lines 水印文本行
 * @returns {Promise<string>} 带水印图片的临时文件路径
 */
function drawToCanvas(options) {
  const opts = options || {};
  const canvas = opts.canvas;
  const imagePath = opts.imagePath;
  const lines = Array.isArray(opts.lines) ? opts.lines : [];

  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.getContext !== 'function' || typeof canvas.createImage !== 'function') {
      reject(new Error('canvas 节点不可用'));
      return;
    }
    if (!imagePath) {
      reject(new Error('图片路径为空'));
      return;
    }

    const image = canvas.createImage();

    image.onload = () => {
      try {
        const srcW = Number(image.width);
        const srcH = Number(image.height);
        if (!(srcW > 0) || !(srcH > 0)) {
          reject(new Error('图片尺寸无效'));
          return;
        }

        // 等比缩放到宽度上限 1600px（不放大）
        const scale = srcW > MAX_WIDTH ? (MAX_WIDTH / srcW) : 1;
        const width = Math.max(1, Math.round(srcW * scale));
        const height = Math.max(1, Math.round(srcH * scale));

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法获取 canvas 绘图上下文'));
          return;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);

        if (lines.length > 0) {
          // 字号按最长行自适应收缩（长地址不再被画布右侧裁掉），排版计算抽到 computeLayout
          const layout = computeLayout({
            width: width,
            height: height,
            lines: lines,
            measure: (text, size) => {
              ctx.font = 'bold ' + size + 'px sans-serif';
              return ctx.measureText(text).width;
            },
          });

          ctx.font = 'bold ' + layout.fontSize + 'px sans-serif';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';

          if (layout.overflows) {
            console.warn(
              '[watermark] 水印文字超出可用宽度，已按最小字号 ' + layout.minFontSize + 'px 绘制：' +
              '最长行字数=' + layout.longestLine.length +
              '，超出=' + Math.round(layout.textWidth - layout.availWidth) + 'px'
            );
          }

          roundRectPath(ctx, layout.boxX, layout.boxY, layout.boxW, layout.boxH, layout.radius);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          for (let i = 0; i < lines.length; i += 1) {
            const textY = layout.boxY + layout.padding + layout.lineHeight * (i + 0.5);
            ctx.fillText(lines[i], layout.boxX + layout.padding, textY);
          }
        }

        if (typeof wx === 'undefined' || !wx.canvasToTempFilePath) {
          reject(new Error('当前环境不支持 canvasToTempFilePath'));
          return;
        }

        wx.canvasToTempFilePath({
          canvas: canvas,
          x: 0,
          y: 0,
          width: width,
          height: height,
          destWidth: width,
          destHeight: height,
          fileType: 'jpg',
          quality: 0.85,
          success: (res) => {
            if (res && res.tempFilePath) {
              resolve(res.tempFilePath);
            } else {
              reject(new Error('导出图片失败'));
            }
          },
          fail: (err) => reject(err || new Error('导出图片失败')),
        });
      } catch (e) {
        reject(e);
      }
    };

    image.onerror = () => {
      reject(new Error('图片加载失败'));
    };

    image.src = imagePath;
  });
}

module.exports = {
  buildLines: buildLines,
  eventNameFor: eventNameFor,
  computeLayout: computeLayout,
  drawToCanvas: drawToCanvas,
};
