// cloudfunctions/adminLogin/index.js —— 后台管理员登录
// 职责：校验账号密码（来自环境变量） -> 签发 7 天有效的 HMAC token
// 安全：账号密码绝不硬编码在代码中，仅存于云函数环境变量。
const cloud = require('wx-server-sdk');
const { signToken } = require('./auth');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const username = (event.username || '').trim();
  const password = (event.password || '').trim();

  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
  const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_SECRET) {
    return {
      success: false,
      code: 'NOT_CONFIGURED',
      message: '管理员账号尚未配置，请在 adminLogin 云函数的环境变量中设置 ADMIN_USERNAME、ADMIN_PASSWORD、ADMIN_SECRET 三个值',
    };
  }

  if (!username || !password) {
    return { success: false, code: 'INVALID', message: '请输入账号和密码' };
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return { success: false, code: 'UNAUTHORIZED', message: '账号或密码错误' };
  }

  const now = Date.now();
  const expiresIn = 7 * 24 * 60 * 60 * 1000; // 7 天
  const token = signToken({ sub: username, iat: now, exp: now + expiresIn });

  return { success: true, data: { token, expires_at: now + expiresIn } };
};
