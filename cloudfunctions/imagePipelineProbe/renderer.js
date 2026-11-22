'use strict';
// Stage 3 shared image implementation. No cloud calls, credentials or device APIs.
const path = require('node:path');
const fs = require('node:fs');
const VERSION = 'server-pango-v1';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 48 * 1000 * 1000;
const FONT = path.join(__dirname, 'fonts', 'wqy-microhei.ttc');
const xml = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
function checkedText(value, length = 120) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, length);
}
function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(number) && number >= 0 && number <= 8640000000000000 ? number : null;
}
function beijing(value) {
  const date = new Date(value + 8 * 3600000);
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} 星期${'日一二三四五六'[date.getUTCDay()]}`;
}
function linesFor(context) {
  const captured = timestamp(context.captureTime), received = timestamp(context.receivedAt);
  const lines = [
    `${checkedText(context.plate, 12) || '车牌未提供'} · ${checkedText(context.eventName, 32) || '现场照片'}`,
    captured !== null ? `拍摄时间：${beijing(captured)}` :
      received !== null ? `服务器收到：${beijing(received)}（拍摄时间未提供）` : '拍摄时间未提供',
    `地点：${checkedText(context.locationText) || '定位未获取'}`,
    `档案：${checkedText(context.recordNo, 40) || '技术试件'}`,
  ];
  // Never present current weather as historical capture weather.
  return lines;
}
async function render(input, context, options = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0 || input.length > MAX_BYTES) throw new Error('IMAGE_BYTES_LIMIT');
  const sharp = options.sharp || require('sharp');
  const fontfile = options.fontfile || FONT;
  if (!fs.existsSync(fontfile)) throw new Error('FONT_UNAVAILABLE');
  const metadata = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error('IMAGE_FORMAT_UNSUPPORTED');
  if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 64) throw new Error('IMAGE_TOO_SMALL');
  const document = context.type === 'WAYBILL';
  let pipeline = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate();
  if (!document) pipeline = pipeline.resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
  const base = await pipeline.flatten({ background: '#ffffff' }).png().toBuffer({ resolveWithObject: true });
  const width = base.info.width, height = base.info.height;
  const padding = Math.max(8, Math.round(width * 0.015));
  const fontSize = Math.max(13, Math.min(36, Math.round(width / 38)));
  const overlayWidth = document ? width : Math.min(width, Math.max(300, Math.round(width * 0.75)));
  const lines = linesFor(context);
  const text = await sharp({ text: {
    text: `<span foreground="#ffffff">${lines.map(xml).join('\n')}</span>`,
    font: `WenQuanYi Micro Hei ${fontSize}`, fontfile,
    width: overlayWidth - padding * 2, wrap: 'word-char', rgba: true, spacing: 5,
  } }).png().toBuffer({ resolveWithObject: true });
  const boxHeight = text.info.height + padding * 2;
  const footer = document || boxHeight > height * 0.5;
  const boxWidth = footer ? width : overlayWidth;
  const box = await sharp({ create: { width: boxWidth, height: boxHeight, channels: 4,
    background: { r: 24, g: 37, b: 33, alpha: footer ? 1 : 0.82 } } })
    .composite([{ input: text.data, left: padding, top: padding }]).png().toBuffer();
  let output = sharp(base.data);
  if (footer) output = output.extend({ bottom: boxHeight, background: '#182521' });
  output = output.composite([{ input: box, left: footer ? 0 : width - boxWidth, top: footer ? height : height - boxHeight }]);
  const result = document ? await output.png().toBuffer() : await output.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  return { buffer: result, extension: document ? 'png' : 'jpg', version: VERSION, lines,
    layout: footer ? 'footer' : 'overlay', original: { width: metadata.width, height: metadata.height, orientation: metadata.orientation || 1 },
    output: { width, height: height + (footer ? boxHeight : 0), contentHeight: height }, bytes: result.length };
}
module.exports = { render, linesFor, timestamp, VERSION, FONT, MAX_BYTES, MAX_PIXELS };
