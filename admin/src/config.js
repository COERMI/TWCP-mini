// 读取部署目录下 config.js 注入的全局配置
const raw = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};

export default {
  envId: raw.envId || '',
  region: raw.region || '',
  transport: raw.transport || 'cloudbase',
};
