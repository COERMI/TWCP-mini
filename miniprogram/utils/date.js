// utils/date.js —— 日期时间工具（统一按设备本地时区，即北京时间 UTC+8 展示；
// 服务器接收时间由云函数记录，作为系统标准时间）

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

// 格式化：YYYY-MM-DD HH:mm:ss
function formatDateTime(d) {
  const date = d || new Date();
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
  );
}

// 星期中文
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
function formatWeekday(d) {
  const date = d || new Date();
  return '星期' + WEEKDAYS[date.getDay()];
}

// 年月日中文：2026年12月1日
function formatDateCN(d) {
  const date = d || new Date();
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

module.exports = { formatDateTime, formatWeekday, formatDateCN };
