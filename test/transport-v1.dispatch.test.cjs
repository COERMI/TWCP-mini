const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup, config, actor, NOW } = require('./helpers/transport-v1.cjs');
const body = Buffer.from(JSON.stringify({ sub: config.adminUsername, iat: NOW, exp: NOW + 600000 })).toString('base64url');
const token = body + '.' + crypto.createHmac('sha256', config.adminSecret).update(body).digest('base64url');
const input = { action: 'prepare', token, request_id: 'dispatch_test_prepare', plate_number: '粤B12345', ship_date: '2026-11-22', description: 'TEST dispatch' };
test('总部恢复未确认入口不新建档案，不向无令牌请求或伪造司机身份暴露入口', async () => {
  const h = setup(), created = await h.ok(input);
  const again = await h.ok({ action: 'adminInvite', token, record_id: created.record.id });
  assert.equal(again.invite, created.invite); assert.equal(again.record.id, created.record.id);
  assert.equal(h.docs('records').length, 1); assert(!JSON.stringify(again).includes('invite_salt'));
  for (const data of [{}, { token: 'bad' }, { OPENID: 'admin' }]) {
    assert.equal((await h.call({ action: 'adminInvite', record_id: created.record.id, ...data })).code, 'FORBIDDEN');
  }
});
test('已领取、已停用和已过期的入口不能在总部重新发给另一名司机', async () => {
  for (const state of ['claimed','revoked','expired']) {
    const h = setup(), created = await h.ok(input);
    if (state === 'claimed') await h.ok({ action:'claim', invite:created.invite, request_id:'dispatch_test_claim', confirm_plate:'粤B12345' }, actor('driver-a'));
    if (state === 'revoked') {
      await h.ok({ action:'revoke', token, invite:created.invite });
      const row = (await h.ok({action:'adminList',token})).list[0];
      assert.equal(row.invite_revoked_at,NOW); assert.equal(row.revision,1);
    }
    if (state === 'expired') {
      const record = h.docs('invites')[0]; record.expires_at = NOW - 1;
      await h.store.transaction(tx => tx.set('transport_v1_invites', record._id, record));
    }
    assert.equal((await h.call({ action:'adminInvite', token, record_id:created.record.id })).code,
      {claimed:'ALREADY_CLAIMED',revoked:'INVITE_UNAVAILABLE',expired:'INVITE_EXPIRED'}[state]);
  }
});
test('后台草稿跨刷新保留同一请求和内容；日期按北京时间生成；字段验证在发送前完成', async () => {
  const D = await import('../admin/src/utils/dispatch.js');
  const memory = new Map(), storage = { getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k) };
  const draft = D.newDraft(crypto);
  Object.assign(draft, {plate_number:'粤b12345',ship_date:'2026-11-22',description:' TEST ', submitted:true});
  D.saveDraft(draft,storage); const restored=D.readDraft(storage);
  assert.equal(restored.request_id,draft.request_id); assert.equal(restored.submitted,true);
  assert.deepEqual(D.preparePayload(restored),D.preparePayload(draft)); assert.equal(D.preparePayload(draft).plate_number,'粤B12345');
  assert.equal(D.validateDraft(draft),''); assert(D.validateDraft({...draft,ship_date:'2026-02-30'}));
  assert(D.validateDraft({...draft,plate_number:'123'})); assert(D.validateDraft({...draft,description:''}));
  assert.equal(D.beijingToday(Date.parse('2026-11-21T16:00:00Z')),'2026-11-22');
  D.clearDraft(storage); assert.equal(D.readDraft(storage),null);
});
