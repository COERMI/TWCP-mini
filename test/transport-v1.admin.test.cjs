const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup, config, NOW, actor, COLLECTIONS } = require('./helpers/transport-v1.cjs');
const { dateBoundary } = require('../cloudfunctions/transportV1/admin');
function token(extra = {}) {
  const payload = Buffer.from(JSON.stringify({ sub: config.adminUsername, iat: NOW, exp: NOW + 3600000, ...extra })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', config.adminSecret).update(payload).digest('base64url');
}
const admin = (h, action, input = {}) => h.ok({ action, token: token(), ...input });
test('三个总部入口均需有效管理员令牌，司机身份、过期、缺有效期和错误主体都拒绝', async () => {
  const h = setup(), id = await h.trip();
  for (const action of ['adminList', 'adminWorkflow', 'adminPhotoLinks']) {
    for (const value of ['', token({ exp: NOW }), token({ exp: undefined }), token({ sub: 'other' })]) {
      const result = await h.call({ action, record_id: id, token: value }, actor('driver-a'));
      assert.equal(result.code, 'FORBIDDEN');
    }
  }
});
test('新版与旧档案明确分源，同车不同趟按内部ID读取且摘要不泄露身份、盐和文件ID', async () => {
  const h = setup(), a = await h.trip(), b = await h.trip();
  const legacyId = 'legacy_record_001';
  await h.store.transaction(tx => tx.set('transport_records', legacyId, {
    _id: legacyId, record_no: 'OLD001', plate_number: '粤B12345', status: 'submitted',
    access_token: 'private-legacy-token', _openid: 'private-driver', created_at: new Date(NOW),
  }));
  const result = await admin(h, 'adminList', { keyword: '粤B12345' });
  assert.equal(result.total, 2); assert.equal(new Set(result.list.map(r => r.id)).size, 2);
  assert(!/owner_openid|invite_salt|access_token|private-driver/.test(JSON.stringify(result)));
  assert.equal((await admin(h, 'adminWorkflow', { record_id: a })).record.id, a);
  assert.equal((await admin(h, 'adminWorkflow', { record_id: b })).record.id, b);
  const legacy = await admin(h, 'adminList', { source: 'legacy' });
  assert.equal(legacy.total, 1); assert.equal(legacy.list[0].phase, 'legacy_submitted');
  assert.equal((await h.call({ action: 'adminWorkflow', token: token(), record_id: legacyId })).code, 'INVALID_RECORD');
});
test('日期使用北京时间左闭右开，包含结束日最后一毫秒，不包含次日零点', async () => {
  const h = setup(), start = dateBoundary('2026-11-22'), end = start + 86400000;
  for (const [i, at] of [start - 1, start, end - 1, end].entries()) {
    const id = `trip_${String(i).repeat(40)}`;
    await h.store.transaction(tx => tx.set(COLLECTIONS.records, id, {
      _id: id, record_no: `DATE${i}`, plate_number: '粤B12345', phase: 'preparing', created_at: at,
    }));
  }
  const result = await admin(h, 'adminList', { date_from: '2026-11-22', date_to: '2026-11-22' });
  assert.deepEqual(result.list.map(r => r.record_no), ['DATE2', 'DATE1']);
  const bad = await h.call({ action: 'adminList', token: token(), date_from: '2026-02-30' });
  assert.equal(bad.code, 'INVALID_DATE');
  assert.equal((await h.call({ action: 'adminList', token: token(), date_from: '2026-11-23', date_to: '2026-11-22' })).code, 'INVALID_DATE');
});
test('同一创建时刻按内部ID稳定分页，关键词按文字匹配，筛选参数拒绝注入', async () => {
  const h = setup(); for (let i = 0; i < 5; i++) await h.trip();
  const a = await admin(h, 'adminList', { page: 1, pageSize: 2 }), b = await admin(h, 'adminList', { page: 2, pageSize: 2 });
  assert.equal(a.total, 5); assert.equal(new Set([...a.list, ...b.list].map(r => r.id)).size, 4);
  assert.equal((await admin(h, 'adminList', { keyword: '.*' })).total, 0);
  for (const payload of [{ source: '__proto__' }, { page: -1 }, { pageSize: 101 }, { phase: { $ne: '' } }]) {
    assert.equal((await h.call({ action: 'adminList', token: token(), ...payload })).success, false);
  }
});
test('详情事件与照片分页超过50项不截断，已移除照片保留原因但不能签链', async () => {
  const h = setup(), id = await h.trip(), e = await h.event(id, 'issue');
  for (let i = 0; i < 53; i++) {
    const p = await h.reserve(id, e, 'ISSUE'); await h.process(id, p);
    if (i === 0) await h.mutate('removePhoto', id, { photo_id: p.photo.id, reason: 'TEST 误拍' });
  }
  const a = await admin(h, 'adminWorkflow', { record_id: id, collection: 'photos' });
  const b = await admin(h, 'adminWorkflow', { record_id: id, collection: 'photos', cursor: a.next_cursor });
  assert.equal(a.items.length, 50); assert.equal(b.items.length, 3); assert.equal(b.next_cursor, null);
  const removed = [...a.items, ...b.items].find(p => p.removed_at);
  assert.equal(removed.removal_reason, 'TEST 误拍');
  assert.equal((await h.call({ action: 'adminPhotoLinks', token: token(), record_id: id, photo_id: removed.id })).code, 'PHOTO_REMOVED');
  assert(!/original_file_id|uploader_id|cloud_path/.test(JSON.stringify(a)));
});
test('总部签链使用照片所属档案，跨趟、外部环境和错归档目录拒绝', async () => {
  const h = setup(), a = await h.trip(), b = await h.trip(), e = await h.event(a, 'issue'), p = await h.photo(a, e, 'ISSUE');
  const links = await admin(h, 'adminPhotoLinks', { record_id: a, photo_id: p });
  assert(links.original_url && links.watermarked_url);
  assert.equal((await h.call({ action: 'adminPhotoLinks', token: token(), record_id: b, photo_id: p })).code, 'INVALID_PHOTO');
  await h.store.transaction(async tx => {
    const photo = await tx.get(COLLECTIONS.photos, p);
    photo.original_file_id = `cloud://${config.environment}.bucket/transport-v1/archive/${b}/${p}/wrong/original`;
    await tx.set(COLLECTIONS.photos, p, photo);
  });
  assert.equal((await h.call({ action: 'adminPhotoLinks', token: token(), record_id: a, photo_id: p })).code, 'INVALID_FILE');
});
test('旧照片兼容保持原事件分组，不根据旧success认定水印合格，也不复制或迁移原记录', async () => {
  const h = setup(), id = 'old_record', event = 'old_event', photo = 'old_photo';
  await h.store.transaction(async tx => {
    await tx.set('transport_records', id, { _id: id, record_no: 'OLD', plate_number: '粤B12345', status: 'submitted', created_at: new Date(NOW) });
    await tx.set('transport_events', event, { _id: event, record_id: id, event_type: 'DOOR_OPEN', event_no: 3, event_name: '原第三次开箱' });
    await tx.set('photo_records', photo, { _id: photo, record_id: id, event_id: event, upload_status: 'success',
      original_url: `cloud://${config.environment}.bucket/transport-records/OLD/original.jpg`,
      watermarked_url: `cloud://${config.environment}.bucket/transport-records/OLD/wm.jpg`, created_at: new Date(NOW) });
  });
  const before = await h.store.get('photo_records', photo);
  const events = await admin(h, 'adminWorkflow', { source: 'legacy', record_id: id });
  const photos = await admin(h, 'adminWorkflow', { source: 'legacy', record_id: id, collection: 'photos' });
  assert.equal(events.items[0].name, '原第三次开箱');
  assert.equal(photos.items[0].event_id, event); assert.equal(photos.items[0].status, 'legacy_unverified');
  assert.equal((await admin(h, 'adminPhotoLinks', { source: 'legacy', record_id: id, photo_id: photo })).legacy_unverified, true);
  assert.deepEqual(await h.store.get('photo_records', photo), before);
});
