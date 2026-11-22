'use strict';
const crypto = require('node:crypto');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(code, message) {
  const error = new Error(message);
  error.businessCode = code;
  throw error;
}
function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function admin(token, config, now) {
  if (!config.adminSecret || !config.adminUsername) fail('NOT_CONFIGURED', '后台身份校验尚未配置');
  if (typeof token !== 'string' || token.length > 2048) fail('FORBIDDEN', '登录已失效，请重新登录');
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0])) fail('FORBIDDEN', '登录已失效，请重新登录');
  const expected = crypto.createHmac('sha256', config.adminSecret).update(parts[0]).digest('base64url');
  if (!equal(parts[1], expected)) fail('FORBIDDEN', '登录已失效，请重新登录');
  let data;
  try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { fail('FORBIDDEN', '登录已失效，请重新登录'); }
  if (!data || data.sub !== config.adminUsername || !Number.isSafeInteger(data.exp) || data.exp <= now ||
      !Number.isSafeInteger(data.iat) || data.iat > now || data.iat >= data.exp ||
      data.exp - data.iat > 7 * 24 * 3600000) fail('FORBIDDEN', '登录已失效，请重新登录');
  return { kind: 'admin', id: data.sub };
}
function driver(context, config) {
  // Identity comes only from the SDK context, never event.OPENID or event.owner.
  if (!config.appId || !context || context.APPID !== config.appId ||
      typeof context.OPENID !== 'string' || !context.OPENID.trim() || context.OPENID.length > 128) {
    fail('IDENTITY_REQUIRED', '请从微信中的本趟运输入口打开');
  }
  return { kind: 'driver', id: context.OPENID };
}
function requestId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{12,80}$/.test(value)) fail('INVALID_REQUEST', '缺少有效请求编号');
  return value;
}
module.exports = { sha, fail, text, equal, admin, driver, requestId };
