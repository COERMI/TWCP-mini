const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createHandler } = require('../scripts/preview-admin.cjs');
async function serverFor(t, invoke) {
  const server = http.createServer(createHandler({ cloudInvoke: invoke }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
test('二维码必须先通过云端管理员和未领取入口校验，浏览器不能自带邀请替换本趟', async t => {
  let allowed = false, previews = 0;
  const server = http.createServer(createHandler({
    cloudInvoke: async(name,data)=>{
      assert.equal(name,'transportV1'); assert.equal(data.action,'adminInvite'); assert.equal(data.token,'provided-token');
      assert.equal(data.invite,undefined);
      return allowed ? {success:true,data:{record:{id:'checked-record'},invite:'checked-invite'}} : {success:false,code:'FORBIDDEN'};
    },
    preview: async invitation => {previews++;assert.equal(invitation.invite,'checked-invite');return {success:true,data:{qr:'test-qr'}};},
  }));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const post=()=>fetch(`http://127.0.0.1:${server.address().port}/api/preview`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:'provided-token',record_id:'checked-record',invite:'attacker-invite'})});
  assert.equal((await (await post()).json()).code,'FORBIDDEN'); assert.equal(previews,0);
  allowed=true;assert.equal((await (await post()).json()).success,true);assert.equal(previews,1);
});
test('本机桥接不注入管理员身份，不代理司机写操作，跨站请求和过大请求拒绝', async t => {
  const calls = [], url = await serverFor(t, async (name, data) => { calls.push({ name, data }); return { success: false, code: 'FORBIDDEN' }; });
  const post = (body, headers = {}) => fetch(url + '/api/cloud', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const denied = await post({ name: 'transportV1', data: { action: 'adminList' } });
  assert.equal((await denied.json()).code, 'FORBIDDEN'); assert.equal(calls[0].data.token, undefined);
  assert.equal((await post({ name: 'transportV1', data: { action: 'completeTrip' } })).status, 400);
  assert.equal((await post({ name: 'transportV1', data: { action: 'adminList' } }, { Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await post({ name: 'transportV1', data: { action: 'adminList', keyword: 'x'.repeat(9000) } })).status, 413);
  assert.equal(calls.length, 1);
  const config = await (await fetch(url + '/config.js')).text();
  assert(config.includes('local-review')); assert(!config.includes('ADMIN_SECRET'));
});
test('联调登录失败五次后限制尝试；公开错误不泄露CLI或配置内容', async t => {
  let count = 0;
  const url = await serverFor(t, async () => { count++; return { success: false, code: 'UNAUTHORIZED' }; });
  const request = () => fetch(url + '/api/cloud', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'adminLogin', data: { username: 'test', password: 'incorrect' } }) });
  for (let i = 0; i < 5; i++) assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 429); assert.equal(count, 5);
  const broken = await serverFor(t, async () => { throw new Error('secret=private'); });
  const response = await fetch(broken + '/api/cloud', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'transportV1', data: { action: 'adminList' } }) });
  assert.equal(response.status, 502); assert(!(await response.text()).includes('private'));
});
