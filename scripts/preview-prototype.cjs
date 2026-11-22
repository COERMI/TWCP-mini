// Local-only preview. Serves the prototype directory, never project config or backups.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../docs/prototype');
const allowed = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/workflow.js', 'text/javascript; charset=utf-8'],
  ['/style.css', 'text/css; charset=utf-8'],
]);
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!allowed.has(pathname) || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404); response.end(); return;
  }
  try {
    const bytes = await fs.readFile(path.join(root, pathname));
    response.writeHead(200, {
      'Content-Type': allowed.get(pathname), 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(500); response.end('Prototype file unavailable');
  }
});
server.listen(4179, '127.0.0.1', () => console.log('Prototype preview: http://127.0.0.1:4179'));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
