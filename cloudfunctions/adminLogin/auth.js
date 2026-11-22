// auth.js —— 管理员登录 token 的签发与校验（HMAC-SHA256 无状态 token）
// 说明：token = base64url(payload) + '.' + HMAC-SHA256(payload, ADMIN_SECRET)
//       payload 内含 exp（过期时间戳），校验时验签并检查是否过期。
//       无需额外数据库集合，密钥来自云函数环境变量 ADMIN_SECRET。
const crypto = require('crypto');

const SECRET = process.env.ADMIN_SECRET || '';

// 签发 token
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

// 校验 token：验签 + 检查是否过期
function verifyToken(token) {
  if (!token || !SECRET) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const body = parts[0];
  const sig = parts[1];
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expected) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return false;
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { signToken, verifyToken };
