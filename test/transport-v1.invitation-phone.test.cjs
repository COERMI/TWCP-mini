const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function pageWith(responder) {
  const storage = new Map(), calls = [], target = { invite: 'a'.repeat(64), record_id: 'trip_test' };
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../tools/invitation-probe/miniprogram/pages/entry/index.js'), 'utf8'), {
    require: () => target, Date, Math,
    Page: definition => { page = definition; },
    wx: {
      getStorageSync: key => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      cloud: { callFunction: async ({ data }) => { calls.push(structuredClone(data)); return responder(data, calls); } },
    },
  });
  page.setData = values => Object.assign(page.data, values);
  return { page, storage, calls };
}
const preview = { plate_number: '粤B12345', ship_date: '2026-11-22', description: 'TEST 运输' };
test('司机先核对车牌，车牌不符不发领取请求，已确认后能读取同一档案', async () => {
  const { page, calls } = pageWith(async input => {
    if (input.action === 'preview') return { result: { success: true, data: { record: preview, claimed: false } } };
    if (input.action === 'claim') return { result: { success: true, data: { record: { ...preview, id: 'trip_test' }, claimed: true } } };
    return { result: { success: true, data: { record: { ...preview, id: 'trip_test' } } } };
  });
  await page.load();
  page.mismatch();
  await page.confirm();
  assert.equal(calls.filter(c => c.action === 'claim').length, 0);
  page.back();
  await page.confirm();
  await page.read();
  assert.equal(page.data.claimed, true);
  assert.equal(page.data.readVerified, true);
  assert.equal(calls.find(c => c.action === 'claim').confirm_plate, '粤B12345');
});
test('领取响应丢失重试复用手机已存请求号，云端拒绝不显示已绑定', async () => {
  const { page, calls, storage } = pageWith(async input => {
    if (input.action === 'preview') return { result: { success: true, data: { record: preview, claimed: false } } };
    if (calls.filter(c => c.action === 'claim').length === 1) throw new Error('模拟响应丢失');
    return { result: { success: false, code: 'FORBIDDEN', message: '入口已关联其他拍摄者' } };
  });
  await page.load();
  await page.confirm();
  assert.equal(storage.size, 1);
  assert.equal(page.data.claimed, false);
  await page.confirm();
  const attempts = calls.filter(c => c.action === 'claim');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].request_id, attempts[1].request_id);
  assert.equal(page.data.claimed, false);
  assert.equal(page.data.error, '入口已关联其他拍摄者');
});
