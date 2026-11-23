'use strict';
// Candidate layouts only. Production keeps renderer.js's existing default until selected.
const path = require('node:path');
const clean = value => String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);
const escape = value => clean(value).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
async function renderStyled(input, context, options = {}) {
  const sharp = options.sharp || require('sharp');
  const { MAX_BYTES, MAX_PIXELS, timestamp, FONT } = require('./renderer');
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_BYTES) throw new Error('IMAGE_BYTES_LIMIT');
  if (!['overlay', 'footer'].includes(options.style)) throw new Error('INVALID_WATERMARK_STYLE');
  const metadata = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error('IMAGE_FORMAT_UNSUPPORTED');
  if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 64) throw new Error('IMAGE_TOO_SMALL');
  const document = context.type === 'WAYBILL';
  let pipeline = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate();
  if (!document) pipeline = pipeline.resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
  const base = await pipeline.flatten({ background: 'white' }).png().toBuffer({ resolveWithObject: true });
  const w = base.info.width, h = base.info.height;
  const pad = Math.max(6, Math.round(w * .015)), font = Math.max(10, Math.round(w / 58));
  const captured = timestamp(context.captureTime), received = timestamp(context.receivedAt);
  const when = captured === null ? received : captured;
  const date = when === null ? null : new Date(when + 8 * 3600000);
  const time = date ? date.toISOString().slice(11, 16) : '--:--';
  const day = date ? `${date.toISOString().slice(0, 10)} 星期${'日一二三四五六'[date.getUTCDay()]}` : '时间未获取';
  const source = captured === null ? '服务器收到时间（拍摄时间未提供）' : '拍摄时间（北京时间）';
  const weather = clean(context.weatherText) || '天气未获取';
  const temperature = typeof context.temperatureC === 'number' && Number.isFinite(context.temperatureC) ?
    `${context.temperatureC}°C` : '温度未获取';
  const location = clean(context.locationText) || '地点未获取';
  const record = clean(context.recordNo) || '编号未获取';
  const photo = clean(context.photoNo) || '照片编号未获取';
  async function text(markup, size = font, width = w - pad * 2) {
    return sharp({ text: { text: markup, font: `WenQuanYi Micro Hei ${size}`,
      fontfile: options.fontfile || FONT, width, wrap: 'word-char', rgba: true, spacing: Math.max(2, Math.round(font * .2)) } })
      .png().toBuffer({ resolveWithObject: true });
  }
  const white = markup => `<span foreground="#ffffff">${markup}</span>`;
  const plate = await text(white(`<b>${escape(context.plate || '车牌未提供')}</b>`), Math.round(font * 1.3), w - pad * 4);
  const plateW = Math.min(w - pad * 2, plate.info.width + pad * 2), plateH = plate.info.height + pad;
  const badge = await sharp({ create: { width: plateW, height: plateH, channels: 4, background: '#c52f35' } })
    .composite([{ input: plate.data, left: pad, top: Math.floor(pad / 2) }]).png().toBuffer();
  const timeWidth = Math.max(24, Math.round((w - pad * 3) * .28));
  const clockText = await text(white(`<b>${time}</b>`), Math.round(font * 2.2), timeWidth);
  const dateText = await text(white(`${escape(day)}\n${escape(weather)} ${escape(temperature)}`),
    font, w - timeWidth - pad * 3);
  const clockH = Math.max(clockText.info.height, dateText.info.height);
  const details = [
    `${clean(context.eventName) || '现场照片'} · ${location}`,
    `运输影像 · ${record} · ${photo}`,
    ...(captured === null ? [source] : []),
    ...(context.sample ? ['排版样例 · 地点天气均为演示数据'] : []),
  ];
  const detailText = await text(white(details.map(escape).join('\n')));
  const boxH = pad * 4 + plateH + clockH + detailText.info.height;
  // Small/panoramic images fall back to appended information: never cover most of a photo.
  const footer = options.style === 'footer' || boxH > h * .45;
  const background = footer ? '#263332' : { r: 20, g: 28, b: 28, alpha: .65 };
  const box = await sharp({ create: { width: w, height: boxH, channels: 4, background } }).composite([
    { input: badge, left: pad, top: pad },
    { input: clockText.data, left: pad, top: pad * 2 + plateH },
    { input: dateText.data, left: pad * 2 + timeWidth, top: pad * 2 + plateH },
    { input: detailText.data, left: pad, top: pad * 3 + plateH + clockH },
  ]).png().toBuffer();
  let output = sharp(base.data);
  if (footer) output = output.extend({ bottom: boxH, background: '#263332' });
  const buffer = await output.composite([{ input: box, left: 0, top: footer ? h : h - boxH }]).png().toBuffer();
  return { buffer, extension: 'png', version: `candidate-v2-${options.style}`,
    layout: footer ? 'footer' : 'overlay', requestedStyle: options.style,
    lines: [clean(context.plate), time, day, source, weather, temperature, ...details],
    output: { width: w, height: h + (footer ? boxH : 0), contentHeight: h, watermarkHeight: boxH },
    bytes: buffer.length };
}
module.exports = { renderStyled };
