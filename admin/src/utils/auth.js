// 管理员登录 token 的本地存取 + 时间格式化工具

const TOKEN_KEY = 'tpa_admin_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch (e) {}
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

export function isLoggedIn() {
  return !!getToken();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// 把服务器返回的时间统一转成北京时间字符串（YYYY-MM-DD HH:mm:ss）
export function formatDateTime(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '-';
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return (
    bj.getUTCFullYear() +
    '-' + pad(bj.getUTCMonth() + 1) +
    '-' + pad(bj.getUTCDate()) +
    ' ' + pad(bj.getUTCHours()) +
    ':' + pad(bj.getUTCMinutes()) +
    ':' + pad(bj.getUTCSeconds())
  );
}

// 北京时间日期（YYYY-MM-DD）
export function formatDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '-';
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return (
    bj.getUTCFullYear() +
    '-' + pad(bj.getUTCMonth() + 1) +
    '-' + pad(bj.getUTCDate())
  );
}
