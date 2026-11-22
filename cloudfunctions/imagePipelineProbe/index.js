'use strict';
// Isolated, expiring stage-3 probe. Never reads/writes the business collections.
const crypto = require('node:crypto');
const cloud = require('wx-server-sdk');
const { render, VERSION, MAX_BYTES, timestamp } = require('./renderer');
const { fixture, CASES } = require('./fixtures');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const TEST_ENV = 'cloud1-d3go2mtsga3f8ea74';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function signed(data) {
  const files = [data.originalFileID, data.watermarkedFileID].filter(Boolean);
  try {
    const response = await cloud.getTempFileURL({ fileList: files });
    const urls = new Map(response.fileList.map(file => [file.fileID, file.tempFileURL]));
    return { ...data, originalUrl: urls.get(data.originalFileID) || null, watermarkedUrl: urls.get(data.watermarkedFileID) || null };
  } catch { return data; }
}
function authorized(event) {
  const expected = process.env.PROBE_KEY || '';
  const supplied = typeof event.ticket === 'string' ? event.ticket : '';
  const expiry = Number(process.env.PROBE_EXPIRES_AT);
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(supplied) ||
    !Number.isFinite(expiry) || expiry <= Date.now()) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
exports.main = async (event = {}) => {
  if (!authorized(event)) return { success: false, code: 'FORBIDDEN', message: '测试入口无效或已过期' };
  const env = cloud.getWXContext().ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
  if (env !== TEST_ENV) return { success: false, code: 'WRONG_ENV', message: '仅允许指定测试环境' };
  const prefix = `stage3-probe/${digest(process.env.PROBE_KEY).slice(0, 24)}`;
  const requestId = String(event.requestId || '');
  if (!/^[a-zA-Z0-9_-]{12,64}$/.test(requestId)) return { success: false, code: 'INVALID_REQUEST' };
  const target = `${prefix}/incoming/${requestId}.jpg`;
  if (event.action === 'prepare') return { success: true, data: { cloudPath: target, version: VERSION, maxBytes: MAX_BYTES } };
  let input, context, fixtureName = null, stage = 'input';
  try {
    if (event.action === 'fixture') {
      fixtureName = String(event.name || '');
      if (!CASES[fixtureName]) return { success: false, code: 'INVALID_FIXTURE' };
      const generated = await fixture(fixtureName);
      input = generated.buffer;
      context = { plate: '粤B12345', recordNo: 'TEST-20261122-0001', type: generated.spec.type || 'DOOR_OPEN',
        eventName: generated.spec.type ? '货运单' : '第1次开门',
        captureTime: '2026-11-22T02:30:00.000Z',
        locationText: '广东省广州市荔湾区岭南花卉市场 · 长中文地址换行验证（合成测试数据）' };
    } else if (event.action === 'process') {
      const fileID = String(event.fileID || '');
      if (!fileID.startsWith(`cloud://${TEST_ENV}.`) || !fileID.endsWith(`/${target}`) ||
        fileID.slice(fileID.indexOf('/', 8) + 1) !== target) return { success: false, code: 'INVALID_FILE' };
      const downloaded = await cloud.downloadFile({ fileID });
      input = downloaded.fileContent;
      context = { plate: '技术试件', recordNo: requestId, type: event.type === 'WAYBILL' ? 'WAYBILL' : 'DOOR_OPEN',
        eventName: event.type === 'WAYBILL' ? '货运单实拍测试' : '现场实拍测试',
        captureTime: timestamp(event.captureTime), receivedAt: Date.now(),
        locationText: '未采集定位 · 图片链路测试' };
    } else return { success: false, code: 'INVALID_ACTION' };
    if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_BYTES) return { success: false, code: 'IMAGE_BYTES_LIMIT' };
    // Content address binds the immutable original and metadata; retries do not create another photo.
    const contentHash = digest(input);
    const metadataHash = digest(JSON.stringify({ ...context, receivedAt: null })).slice(0, 16);
    const root = `${prefix}/results/${requestId}/${contentHash.slice(0, 20)}-${metadataHash}`;
    stage = 'archive-original';
    const original = await cloud.uploadFile({ cloudPath: `${root}/original.jpg`, fileContent: input });
    let result;
    const start = Date.now();
    try {
      result = await render(input, context);
    } catch (error) {
      return { success: true, data: await signed({ requestId, status: 'watermark_failed', originalFileID: original.fileID,
        watermarkedFileID: null, originalSha256: contentHash, version: VERSION,
        error: ['FONT_UNAVAILABLE', 'IMAGE_FORMAT_UNSUPPORTED', 'IMAGE_TOO_SMALL', 'IMAGE_BYTES_LIMIT'].includes(error.message) ? error.message : 'RENDER_FAILED' }) };
    }
    const derived = await cloud.uploadFile({ cloudPath: `${root}/${VERSION}.${result.extension}`, fileContent: result.buffer });
    return { success: true, data: await signed({ requestId, fixture: fixtureName, status: 'ready', version: VERSION,
      originalFileID: original.fileID, watermarkedFileID: derived.fileID,
      originalSha256: contentHash, watermarkedSha256: digest(result.buffer),
      originalBytes: input.length, outputBytes: result.bytes, original: result.original,
      output: result.output, layout: result.layout, elapsedMs: Date.now() - start,
      lines: result.lines, runtime: process.version, platform: process.platform }) };
  } catch (error) {
    return { success: false, code: 'PROBE_FAILED', message: '测试图片处理失败，原文件不会被删除',
      stage, diagnostic: String(error.message || error.code || error.name).replaceAll(process.env.PROBE_KEY, '[redacted]').slice(0, 600) };
  }
};
