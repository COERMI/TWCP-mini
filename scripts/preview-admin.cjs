'use strict';
// Local review only: browser -> loopback -> CloudBase CLI -> deployed function.
// The bridge never supplies a business token. Each protected cloud action still
// verifies the administrator token from the normal login form.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const execute = promisify(execFile);
const { createPreviewer } = require('./admin-preview.cjs');
const privateRoot = path.join(process.env.LOCALAPPDATA || '', 'Codex', 'transport-v1-20261122');
const dist = path.resolve(__dirname, '../admin/dist');
const actions = new Set(['adminList', 'adminWorkflow', 'adminPhotoLinks', 'adminGet', 'prepare', 'adminInvite', 'revoke']);
async function invoke(name, data) {
  const directory = path.join(privateRoot, 'local-admin-requests'), id = crypto.randomBytes(16).toString('hex');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, id + '.private.json');
  await fs.writeFile(file, JSON.stringify(data));
  try {
    const { stdout } = await execute(process.execPath,
      [path.join(process.env.APPDATA, 'npm/node_modules/@cloudbase/cli/bin/tcb'),
        'fn', 'invoke', name, '--cwd', privateRoot, '-d', '@' + file, '--json'],
      { timeout: 45000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    const response = JSON.parse(stdout);
    if (response.error || !response.data || !response.data.RetMsg) throw new Error('INVOCATION_FAILED');
    return JSON.parse(response.data.RetMsg);
  } finally { await fs.rm(file, { force: true }); }
}
function createHandler({ cloudInvoke = invoke, directory = dist, preview = createPreviewer() } = {}) {
  let active = 0;
  const failures = [];
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); };
    const port = request.socket.localPort, host = request.headers.host;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return send(403, { success: false, message: '仅本机联调可用' });
    const origin = request.headers.origin;
    if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) return send(403, { success: false, message: '请求来源不符' });
    const url = new URL(request.url, `http://${host}`);
    if (url.pathname === '/api/cloud' || url.pathname === '/api/preview') {
      if (request.method !== 'POST' || !String(request.headers['content-type']).startsWith('application/json')) return send(405, { success: false });
      let size = 0, buffer = '';
      try {
        for await (const chunk of request) { size += chunk.length; if (size > 8192) return send(413, { success: false }); buffer += chunk.toString(); }
        const input = JSON.parse(buffer);
        const isPreview = url.pathname === '/api/preview';
        const name = isPreview ? 'transportV1' : input.name;
        const data = isPreview ? { action: 'adminInvite', record_id: input.record_id, token: input.token } : input.data;
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            !(name === 'adminLogin' || (name === 'transportV1' && actions.has(data.action)))) return send(400, { success: false, message: '不支持的联调操作' });
        if (name === 'adminLogin' && (typeof data.username !== 'string' || typeof data.password !== 'string')) return send(400, { success: false });
        const now = Date.now();
        while (failures.length && failures[0] <= now - 15 * 60000) failures.shift();
        if (name === 'adminLogin' && failures.length >= 5) return send(429, { success: false, message: '登录尝试较多，请15分钟后再试' });
        if (active >= 4) return send(503, { success: false, message: '正在读取其他记录，请稍后重试' });
        active++;
        try {
          const result = await cloudInvoke(name, data);
          if (name === 'adminLogin' && !result.success) failures.push(now);
          if (isPreview && result.success) return send(200, await preview(result.data));
          return send(200, result);
        } finally { active--; }
      } catch { return send(502, { success: false, message: '云端读取未完成，请重试；筛选条件已保留' }); }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, { success: false });
    if (url.pathname === '/config.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return response.end(`window.__APP_CONFIG__=${JSON.stringify({
        envId: 'cloud1-d3go2mtsga3f8ea74', region: 'ap-shanghai', transport: 'local-review',
      })};`);
    }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return send(400, { success: false }); }
    const file = path.resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(directory, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return send(403, { success: false });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
    if (!types[path.extname(file)]) return send(404, { success: false });
    try { const bytes = await fs.readFile(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] }); response.end(bytes); }
    catch { if (!response.headersSent) send(404, { success: false }); else response.end(); }
  };
}
if (require.main === module) {
  const server = http.createServer(createHandler());
  server.listen(4180, '127.0.0.1', () => console.log('总部测试后台已启动：http://127.0.0.1:4180/（仅本机；真实云数据；仍需管理员登录）'));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口4180已占用，请先核对现有服务' : '本机后台启动失败'); process.exitCode = 1; });
}
module.exports = { createHandler };
