const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createService, COLLECTIONS } = require('../cloudfunctions/transportV1/service');
const { createStore } = require('../cloudfunctions/transportV1/store');
const NOW = Date.parse('2026-11-22T08:00:00Z');
const configuration = {
  environment: 'cloud1-d3go2mtsga3f8ea74', appId: 'wx2c993513e03bb60a',
  adminUsername: 'test-admin', adminSecret: 'unit-test-only-secret',
  inviteSecret: 'unit-test-invitation-only-secret-32bytes',
};
function sign(payload, secret = configuration.adminSecret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
const adminToken = sign({ sub: configuration.adminUsername, iat: NOW - 1000, exp: NOW + 100000 });
const actor = id => ({ ENV: configuration.environment, APPID: configuration.appId, OPENID: id });
const adminContext = { ENV: configuration.environment };
function setup() {
  let now = NOW, revision = 0;
  let data = new Map();
  const store = {
    get: async (collection, id) => structuredClone(data.get(`${collection}/${id}`) || null),
    async transaction(callback) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const base = revision, snapshot = structuredClone(data);
        const tx = {
          get: async (collection, id) => structuredClone(snapshot.get(`${collection}/${id}`) || null),
          set: async (collection, id, value) => { snapshot.set(`${collection}/${id}`, structuredClone(value)); },
        };
        const result = await callback(tx);
        if (base !== revision) continue;
        data = snapshot; revision++;
        return result;
      }
      throw new Error('Conflict retries exhausted');
    },
  };
  const service = createService({ store, config: configuration, clock: () => now });
  return {
    call: (input, context = adminContext) => service.main(input, context),
    documents: collection => [...data.entries()].filter(([key]) => key.startsWith(collection + '/')).map(([, value]) => structuredClone(value)),
    advance: ms => { now += ms; },
    store,
  };
}
const prepareInput = (id = 'prepare_request_0001') => ({
  action: 'prepare', token: adminToken, request_id: id, plate_number: '粤B12345',
  ship_date: '2026-11-22', description: '昆明基地 · 广州方向', batch: '',
});
async function prepared(h, id) {
  const response = await h.call(prepareInput(id));
  assert.equal(response.success, true, response.message);
  return response.data;
}
const claimInput = (invite, id = 'claim_request_000001') => ({
  action: 'claim', invite, request_id: id, confirm_plate: '粤B12345',
});
test('后台创建时序号、档案、入口、审计原子保存，响应不含原始身份或签发盐', async () => {
  const h = setup(), a = await prepared(h);
  assert.match(a.record.record_no, /^TR202611000001$/);
  assert.equal(a.record.phase, 'awaiting_plate');
  assert.match(a.invite, /^[a-f0-9]{64}$/);
  for (const name of ['records', 'invites', 'audit', 'counters']) assert.equal(h.documents(COLLECTIONS[name]).length, 1);
  assert.equal(h.documents(COLLECTIONS.invites)[0]._id, crypto.createHash('sha256').update(a.invite).digest('hex'));
  assert(!JSON.stringify(a).includes('owner_openid'));
  assert(!JSON.stringify(a).includes('invite_salt'));
  assert(!JSON.stringify(h.documents(COLLECTIONS.invites)).includes(a.invite));
});
test('重复及并发创建复用同一档案、编号和入口，修改内容不能复用请求号', async () => {
  const h = setup();
  const responses = await Promise.all(Array.from({ length: 8 }, () => h.call(prepareInput())));
  assert(responses.every(item => item.success));
  assert.equal(new Set(responses.map(item => item.data.invite)).size, 1);
  assert.equal(h.documents(COLLECTIONS.records).length, 1);
  assert.equal(h.documents(COLLECTIONS.counters)[0].seq, 1);
  assert.equal((await h.call({ ...prepareInput(), description: '另一个目的地' })).code, 'REQUEST_CONFLICT');
});
test('同车牌并发创建不同运输时各自独立且编号唯一', async () => {
  const h = setup();
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => h.call(prepareInput(`new_trip_request_${i}`))));
  assert(responses.every(item => item.success));
  assert.equal(new Set(responses.map(item => item.data.record.id)).size, 8);
  assert.equal(new Set(responses.map(item => item.data.record.record_no)).size, 8);
  assert.equal(new Set(responses.map(item => item.data.invite)).size, 8);
});
test('缺失、过期、无exp、伪造及不同主体管理员令牌均不能创建', async () => {
  for (const token of ['', 'broken', sign({ sub: configuration.adminUsername, iat: NOW - 1000, exp: NOW }),
    sign({ sub: configuration.adminUsername, iat: NOW }),
    sign({ sub: 'someone-else', iat: NOW - 1, exp: NOW + 1000 }),
    sign({ sub: configuration.adminUsername, iat: NOW - 1, exp: NOW + 1000 }, 'wrong-secret')]) {
    const h = setup();
    assert.equal((await h.call({ ...prepareInput(), token })).success, false);
    assert.equal(h.documents(COLLECTIONS.records).length, 0);
  }
});
test('无效车牌、无效日期和过长说明不会消耗档案号', async () => {
  const h = setup();
  for (const values of [{ plate_number: '123' }, { ship_date: '2026-02-30' }, { description: '长'.repeat(121) }]) {
    assert.equal((await h.call({ ...prepareInput(), ...values })).success, false);
  }
  assert.equal(h.documents(COLLECTIONS.counters).length, 0);
});
test('未确认入口只返回核对车牌所需信息，不绑定司机', async () => {
  const h = setup(), { invite } = await prepared(h);
  const p = await h.call({ action: 'preview', invite }, actor('driver-a'));
  assert.equal(p.success, true);
  assert.equal(p.data.claimed, false);
  assert.deepEqual(Object.keys(p.data.record).sort(), ['description', 'plate_number', 'ship_date']);
  assert.equal(h.documents(COLLECTIONS.records)[0].owner_openid, null);
});
test('确认车牌前不得绑定，正确确认后重复打开接续同趟且不重复审计', async () => {
  const h = setup(), { invite, record } = await prepared(h);
  assert.equal((await h.call({ ...claimInput(invite), confirm_plate: '粤B54321' }, actor('driver-a'))).code, 'PLATE_MISMATCH');
  assert.equal(h.documents(COLLECTIONS.records)[0].owner_openid, null);
  const result = await h.call(claimInput(invite), actor('driver-a'));
  assert.equal(result.data.record.phase, 'preparing');
  for (let n = 0; n < 3; n++) {
    assert.equal((await h.call(claimInput(invite), actor('driver-a'))).data.record.id, record.id);
    assert.equal((await h.call({ action: 'preview', invite }, actor('driver-a'))).data.claimed, true);
  }
  assert.equal(h.documents(COLLECTIONS.audit).filter(item => item.action === 'confirm_plate_and_claim').length, 1);
  assert.equal(h.documents(COLLECTIONS.records)[0].revision, 1);
});
test('两位司机同时确认只有一位成功，另一位不能预览和读取', async () => {
  const h = setup(), { invite, record } = await prepared(h);
  const results = await Promise.all(['driver-a', 'driver-b'].map(id => h.call(claimInput(invite), actor(id))));
  assert.equal(results.filter(item => item.success).length, 1);
  const owner = h.documents(COLLECTIONS.records)[0].owner_openid;
  const other = owner === 'driver-a' ? 'driver-b' : 'driver-a';
  assert.equal((await h.call({ action: 'get', record_id: record.id }, actor(other))).code, 'FORBIDDEN');
  assert.equal((await h.call({ action: 'preview', invite }, actor(other))).code, 'FORBIDDEN');
  assert.equal((await h.call({ action: 'get', record_id: record.id }, actor(owner))).success, true);
});
test('请求中的OPENID、token或身份字段不能冒充可信微信身份', async () => {
  const h = setup(), { invite } = await prepared(h);
  for (const context of [adminContext, { ...actor('driver-a'), APPID: 'another-app' }]) {
    assert.equal((await h.call({ ...claimInput(invite), OPENID: 'driver-a', owner_openid: 'driver-a' }, context)).code, 'IDENTITY_REQUIRED');
  }
});
test('领取请求编号不得跨运输复用，第二趟不会被部分绑定', async () => {
  const h = setup(), a = await prepared(h), b = await prepared(h, 'prepare_request_0002');
  assert.equal((await h.call(claimInput(a.invite), actor('driver-a'))).success, true);
  assert.equal((await h.call(claimInput(b.invite), actor('driver-a'))).code, 'REQUEST_CONFLICT');
  assert.equal(h.documents(COLLECTIONS.records).find(r => r._id === b.record.id).owner_openid, null);
});
test('入口过期未绑定时拒绝，已经绑定的司机仍能接续原趟', async () => {
  const h = setup(), a = await prepared(h), b = await prepared(h, 'prepare_request_0002');
  await h.call(claimInput(a.invite), actor('driver-a'));
  h.advance(8 * 24 * 3600000);
  assert.equal((await h.call({ action: 'preview', invite: b.invite }, actor('driver-b'))).code, 'INVITE_EXPIRED');
  assert.equal((await h.call(claimInput(b.invite), actor('driver-b'))).code, 'INVITE_EXPIRED');
  assert.equal((await h.call({ action: 'preview', invite: a.invite }, actor('driver-a'))).success, true);
  assert.equal((await h.call({ action: 'get', record_id: a.record.id }, actor('driver-a'))).success, true);
});
test('后台可幂等撤销未领取入口；领取后拒绝简单撤销，避免司机失联', async () => {
  const h = setup(), a = await prepared(h);
  for (let n = 0; n < 2; n++) assert.equal((await h.call({ action: 'revoke', invite: a.invite, token: adminToken })).success, true);
  assert.equal((await h.call({ action: 'preview', invite: a.invite }, actor('driver-a'))).code, 'INVITE_UNAVAILABLE');
  assert.equal(h.documents(COLLECTIONS.audit).filter(item => item.action === 'revoke_unclaimed_invite').length, 1);
  const b = await prepared(h, 'prepare_request_0002');
  await h.call(claimInput(b.invite), actor('driver-a'));
  assert.equal((await h.call({ action: 'revoke', invite: b.invite, token: adminToken })).code, 'ALREADY_CLAIMED');
});
test('正式get只准所有者，后台独立令牌读取且不泄露司机身份', async () => {
  const h = setup(), a = await prepared(h);
  assert.equal((await h.call({ action: 'get', record_id: a.record.id }, actor('driver-a'))).code, 'FORBIDDEN');
  assert.equal((await h.call({ action: 'adminGet', record_id: a.record.id, token: '' })).code, 'FORBIDDEN');
  const r = await h.call({ action: 'adminGet', record_id: a.record.id, token: adminToken });
  assert.equal(r.success, true);
  assert(!JSON.stringify(r).includes('owner_openid'));
});
test('错误环境、未知操作及异常存储都安全拒绝，不返回底层错误或秘密', async () => {
  const h = setup();
  assert.equal((await h.call(prepareInput(), { ENV: 'production' })).code, 'WRONG_ENV');
  assert.equal((await h.call({ action: '__proto__' })).code, 'INVALID_ACTION');
  const broken = createService({ store: { transaction: async () => { throw new Error('secret=should-never-leak'); } }, config: configuration, clock: () => NOW });
  const result = await broken.main(prepareInput(), adminContext);
  assert.equal(result.code, 'RETRY_LATER');
  assert(!JSON.stringify(result).includes('should-never-leak'));
});
test('wx SDK 适配器在事务中移除只读_id，空文档与存储异常区分', async () => {
  let body;
  const sdk = {
    collection: () => ({ doc: () => ({
      get: async () => ({ data: null }),
      set: async input => { body = input; },
    }) }),
    runTransaction: async callback => callback(sdk),
  };
  const store = createStore(sdk);
  assert.equal(await store.get('records', 'a'), null);
  await store.transaction(tx => tx.set('records', 'a', { _id: 'a', phase: 'preparing' }));
  assert.deepEqual(body, { data: { phase: 'preparing' } });
  await assert.rejects(store.transaction(tx => tx.set('records', 'a', { _id: 'b' })), /identity mismatch/);
  sdk.collection = () => ({ doc: () => ({ get: async () => { throw new Error('DB offline'); } }) });
  await assert.rejects(store.get('records', 'a'), /DB offline/);
});
test('云函数包装器使用平台命名空间兜底环境，绝不从请求取得微信身份', async () => {
  const exports = {};
  let passedContext, dbOptions;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/transportV1/index.js'), 'utf8'), {
    exports,
    process: { env: { SCF_NAMESPACE: configuration.environment } },
    require(name) {
      if (name === 'wx-server-sdk') return {
        init() {}, database: options => { dbOptions = options; return {}; },
        getWXContext: () => ({ OPENID: 'trusted-driver', APPID: configuration.appId }),
      };
      if (name === './store') return { createStore: () => ({}) };
      if (name === './media') return { createMedia: () => ({}) };
      if (name === './service') return { createService: () => ({
        main: async (input, context) => { passedContext = context; return { success: true }; },
      }) };
      throw new Error('Unexpected import');
    },
  });
  await exports.main({ OPENID: 'forged-driver', ENV: 'production' });
  assert.equal(passedContext.ENV, configuration.environment);
  assert.equal(passedContext.OPENID, 'trusted-driver');
  assert.equal(dbOptions.throwOnNotFound, false);
});
