// CloudBase Web SDK 封装：初始化 + 匿名登录 + 调用云函数
import cloudbase from '@cloudbase/js-sdk';

let app = null;
let loginPromise = null;
let transportConfig = {};

export function initApp(config) {
  transportConfig = config;
  if (config.transport === 'local-review') return null;
  if (app) return app;
  const opts = { env: config.envId };
  if (config.region) opts.region = config.region;
  app = cloudbase.init(opts);
  return app;
}

export function getApp() {
  return app;
}

// 匿名登录（Web 端调用云函数前需要已登录）
// 兼容 3.x 的 signInAnonymously 与旧版 anonymousAuthProvider 两种写法
export function ensureLogin() {
  if (!app) return Promise.reject(new Error('CloudBase 未初始化，请先填写 envId'));
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const auth = app.auth();
    if (typeof auth.signInAnonymously === 'function') {
      await auth.signInAnonymously();
    } else if (typeof auth.anonymousAuthProvider === 'function') {
      await auth.anonymousAuthProvider().signIn();
    } else {
      throw new Error('当前 SDK 不支持匿名登录');
    }
  })().catch((e) => {
    loginPromise = null;
    throw e;
  });
  return loginPromise;
}

// 调用云函数，返回 res.result（云函数 main 的返回值）
export async function callFunction(name, data = {}) {
  if (transportConfig.transport === 'local-review') {
    const response = await fetch('/api/cloud', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }), credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('本机联调服务暂时不可用，请重试');
    return response.json();
  }
  await ensureLogin();
  const res = await app.callFunction({ name, data });
  return res.result;
}
