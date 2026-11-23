const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load(name, api = {}, wx = {}) {
  let page;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
    `../tools/workflow-probe/miniprogram/pages/${name}/index.js`), 'utf8'), {
    Page: definition => { page = definition; }, wx,
    getApp: () => ({ globalData: {} }),
    require: id => id.endsWith('/transport') ? api : require(path.resolve(__dirname,
      '../tools/workflow-probe/miniprogram/pages/' + name, id)),
    Date, encodeURIComponent,
  });
  page.data = structuredClone(page.data);
  page.setData = data => Object.assign(page.data, data);
  return page;
}
test('关门归档后自动保存组，但本机还有待传照片时不提前保存', async () => {
  const calls = [];
  const page = load('trip', { mutate: async (...args) => calls.push(args) });
  page.recordId = 'trip-test'; page.reload = async () => {};
  page.data.activeDoor = { id: 'door-test', canFinish: true };
  page.queue = { list: () => [{ event_id: 'door-test' }] };
  await page.saveReadyDoor();
  assert.equal(calls.length, 0);
  page.queue.list = () => [];
  await page.saveReadyDoor();
  assert.equal(calls[0][1], 'finishDoor');
  assert.equal(calls.some(c => c[1] === 'complete'), false);
});
test('自动保存组响应丢失后保留当前组，可再次沿用业务请求继续保存', async () => {
  let attempts = 0;
  const page = load('trip', { mutate: async () => { if (++attempts === 1) throw Error('lost'); } });
  page.recordId = 'trip-test'; page.reload = async () => { page.data.activeDoor = null; };
  page.data.activeDoor = { id: 'door-test', canFinish: true };
  page.queue = { list: () => [] };
  await assert.rejects(page.saveReadyDoor(), /lost/);
  assert(page.data.activeDoor);
  await page.saveReadyDoor();
  assert.equal(page.data.activeDoor, null);
});
test('开始运输直接提交，不弹重复确认；待传原图仍阻止提交', async () => {
  const calls = [];
  const page = load('trip', { mutate: async (...args) => calls.push(args) });
  page.recordId = 'trip-test'; page.reload = async () => {};
  page.queue = { list: () => [{ id: 'pending' }] };
  await page.depart();
  assert.equal(calls.length, 0);
  page.queue.list = () => [];
  await page.depart();
  assert.equal(calls[0][1], 'submitBase');
});
test('聊天卡片仅包含所选本趟邀请，不包含管理员令牌；更换查询立即清空旧选择', async () => {
  const invite = 'a'.repeat(64);
  const page = load('dispatch', { call: async input => input.action === 'adminInvite' ?
    { invite, invite_expires_at: Date.now() + 60000 } : { list: [], total: 0, pageSize: 20 } });
  page.token = 'private-admin-token';
  page.data.rows = [{ id: 'trip-a', plate_number: '津CJ0836', ship_date: '2026-11-23' }];
  await page.select({ currentTarget: { dataset: { id: 'trip-a' } } });
  const card = page.onShareAppMessage();
  assert(card.path.endsWith(invite));
  assert(!JSON.stringify(card).includes(page.token));
  assert.equal(card.imageUrl, '/assets/share-card.png', '不用管理员列表截图作为分享图片');
  await page.search();
  assert.equal(page.onShareAppMessage().path, '/pages/entry/index');
});
test('分享入口不自动领取，确认车牌后才进入；没有入口不寻找历史运输', async () => {
  let calls = 0;
  const page = load('entry', {}, { cloud: { callFunction: async () => {
    calls++;
    return { result: { success: true, data: { claimed: false, record: { id: 'trip-a' } } } };
  } } });
  page.onLoad({});
  assert.equal(calls, 0);
  page.onLoad({ invite: 'b'.repeat(64) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(page.data.claimed, false);
});
