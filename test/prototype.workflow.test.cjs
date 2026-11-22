const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../docs/prototype/workflow.js');
// Earlier unload tests cover retained legacy records; new driver flows use door groups.
const store = () => ({ records: [], invites: [], actor: { ...W.DRIVER } });
function prepare(data = store(), date = '2026-11-21') {
  return { data, ...W.prepare(data, { plate: '粤B12345', shipDate: date, description: '昆明基地装货 · 广州方向' }) };
}
function photo(record, group, type, status = 'ready') {
  const event = W.ensureEvent(record, type, group);
  const saved = W.attachPhoto(record, event, {
    id: W.id('photo'), status, captureTime: '2026-11-21T03:00:00.000Z', attempts: 1,
  }, W.DRIVER);
  return { event, saved };
}
test('同一邀请重复打开三次不创建档案，领取保持同一拍摄者', () => {
  const { data, record, invite } = prepare();
  W.inviteAccess(data, invite.id, W.DRIVER, true);
  for (let n = 0; n < 3; n++) assert.equal(W.inviteAccess(data, invite.id).record.id, record.id);
  assert.equal(data.records.length, 1);
  assert.equal(record.audit.filter(item => item.type === 'claim_invitation').length, 1);
});
test('转发后的另一身份被拒绝，专门接续邀请允许协助者且保留原档案', () => {
  const { data, record, invite } = prepare();
  assert.throws(() => W.inviteAccess(data, invite.id, W.HELPER, true), /其他拍摄者/);
  W.inviteAccess(data, invite.id, W.DRIVER, true);
  assert.throws(() => W.inviteAccess(data, invite.id, W.HELPER, true), /其他拍摄者/);
  const continuation = W.continuation(data, record, W.HELPER);
  assert.throws(() => W.inviteAccess(data, continuation.id, W.DRIVER, true), /其他拍摄者/);
  assert.equal(W.inviteAccess(data, continuation.id, W.HELPER, true).record.id, record.id);
});
test('无效与撤销邀请不创建新趟', () => {
  const { data, invite } = prepare();
  assert.throws(() => W.inviteAccess(data, 'missing'), /失效/);
  invite.revokedAt = W.now();
  assert.throws(() => W.inviteAccess(data, invite.id), /失效/);
  assert.equal(data.records.length, 1);
});
test('运单未到可独立拍空厢和预冷，但货物基础项仍锁定', () => {
  const { record } = prepare();
  const group = W.startGroup(record, 'before');
  photo(record, group, 'EMPTY_COMPARTMENT');
  photo(record, group, 'PRECOOL_TEMP');
  assert.throws(() => W.ensureEvent(record, 'CARGO_PHOTO'), /运单/);
  photo(record, null, 'WAYBILL');
  assert.doesNotThrow(() => W.ensureEvent(record, 'CARGO_PHOTO'));
  assert.throws(() => W.ensureEvent(record, 'LOADED_COMPARTMENT'), /运单/);
});
test('一次卸货多张和重新提交同一照片ID不会增加事件或照片', () => {
  const { record } = prepare(), group = W.startGroup(record, 'unload');
  const { event, saved } = photo(record, group, 'UNLOAD_CARGO', 'failed');
  photo(record, group, 'UNLOAD_CARGO');
  photo(record, group, 'UNLOAD_CARGO');
  assert.equal(W.ensureEvent(record, 'UNLOAD_CARGO', group), event);
  assert.equal(W.attachPhoto(record, event, { ...saved, captureTime: W.now() }, W.HELPER), saved);
  saved.status = 'ready';
  assert.equal(event.photos.length, 3);
  assert.equal(record.groups.length, 1);
  assert.equal(saved.captureTime, '2026-11-21T03:00:00.000Z');
  assert.equal(saved.uploader.id, W.DRIVER.id);
});
test('中途卸货选还有下一站，不确认整车送完；再次卸货分开', () => {
  const { record } = prepare();
  const first = W.startGroup(record, 'unload'); photo(record, first, 'UNLOAD_PROCESS');
  W.finishStop(record, first, 'more', W.DRIVER);
  const second = W.startGroup(record, 'unload');
  assert.notEqual(first.id, second.id);
  assert.equal(second.sequence, 2);
  assert.equal(record.deliveryConfirmedAt, null);
});
test('空卸货草稿取消后不留下假站次，下一次仍为第一次', () => {
  const { record } = prepare(), group = W.startGroup(record, 'unload');
  W.ensureEvent(record, 'UNLOAD_DOOR', group);
  assert.equal(W.committed(record, group), false);
  assert.equal(W.cancelEmptyGroup(record, group), true);
  assert.equal(record.groups.length, 0); assert.equal(record.events.length, 0);
  assert.equal(W.startGroup(record, 'unload').sequence, 1);
});
test('全部送完且签收单未到：确认时间存在，资料仍待补，原组可补签收单', () => {
  const { record } = prepare(), group = W.startGroup(record, 'unload');
  photo(record, group, 'UNLOAD_AFTER');
  W.finishStop(record, group, 'none', W.DRIVER);
  const confirmedAt = record.deliveryConfirmedAt;
  assert(confirmedAt);
  assert(W.missing(record).some(item => item.type === 'RECEIPT' && item.group_id === group.id));
  photo(record, group, 'RECEIPT');
  assert(!W.missing(record).some(item => item.type === 'RECEIPT' && item.group_id === group.id));
  assert.equal(record.deliveryConfirmedAt, confirmedAt);
  W.finishStop(record, group, 'none', W.DRIVER);
  assert.equal(record.audit.filter(item => item.type === 'delivery_confirmed').length, 1);
});
test('送完确认后新增卸货须先纠正，纠正保留原时间与操作者', () => {
  const { record } = prepare(), group = W.startGroup(record, 'unload');
  W.finishStop(record, group, 'none', W.DRIVER);
  const previous = record.deliveryConfirmedAt;
  assert.throws(() => W.startGroup(record, 'unload'), /先纠正/);
  assert.throws(() => W.finishStop(record, group, 'more', W.DRIVER), /先纠正/);
  assert.throws(() => W.correctDelivery(record, W.DRIVER, ''), /原因/);
  W.correctDelivery(record, W.DRIVER, '误点了，还有下一站');
  assert.equal(record.deliveryConfirmedAt, null);
  assert.equal(record.audit.at(-1).previous_confirmed_at, previous);
  assert.equal(record.audit.at(-1).actor.id, W.DRIVER.id);
  assert.equal(W.startGroup(record, 'unload').sequence, 2);
});
test('先不确定不会自动确认全部送完', () => {
  const { record } = prepare(), group = W.startGroup(record, 'unload');
  W.finishStop(record, group, 'unsure', W.DRIVER);
  assert.equal(record.deliveryConfirmedAt, null); assert.equal(group.outcome, 'unsure');
});
test('资料全部齐全也不能自动把运输判定为送完', () => {
  const { record } = prepare();
  for (const type of W.BASE) photo(record, null, type);
  for (const kind of ['before', 'after', 'unload']) {
    const group = W.startGroup(record, kind);
    for (const type of W.GROUPS[kind].types) photo(record, group, type);
  }
  assert.equal(W.missing(record).length, 0);
  assert.equal(record.deliveryConfirmedAt, null);
  assert.equal(record.departedAt, null);
});
test('有后续实际卸货记录时，不能在早先站次确认整车送完', () => {
  const { record } = prepare(), first = W.startGroup(record, 'unload');
  W.finishStop(record, first, 'more', W.DRIVER);
  const second = W.startGroup(record, 'unload'); photo(record, second, 'UNLOAD_CARGO');
  assert.throws(() => W.finishStop(record, first, 'none', W.DRIVER), /后面还有卸货/);
  assert.equal(record.deliveryConfirmedAt, null);
});
test('隔天同车新趟不会改旧趟队列，旧邀请仍指向旧趟', () => {
  const { data, record: old, invite } = prepare();
  const group = W.startGroup(old, 'unload');
  const { saved } = photo(old, group, 'RECEIPT', 'queued');
  const next = prepare(data, '2026-11-22').record;
  assert.notEqual(next.id, old.id);
  assert.equal(W.pending(old)[0].photo.id, saved.id);
  assert.equal(W.pending(next).length, 0);
  assert.equal(W.inviteAccess(data, invite.id, W.DRIVER, true).record.id, old.id);
  assert.equal(saved.record_id, old.id); assert.equal(saved.group_id, group.id);
  assert.throws(() => W.attachPhoto(next, W.ensureEvent(next, 'WAYBILL'), saved, W.DRIVER), /不能移动/);
});
test('跨记录事件和错误现场项目被拒绝', () => {
  const data = store(), a = prepare(data).record, b = prepare(data).record;
  const group = W.startGroup(a, 'before'), event = W.ensureEvent(a, 'EMPTY_COMPARTMENT', group);
  assert.throws(() => W.ensureEvent(b, 'EMPTY_COMPARTMENT', group), /不属于/);
  assert.throws(() => W.attachPhoto(b, event, { id: 'photo' }, W.DRIVER), /不属于/);
  assert.throws(() => W.ensureEvent(a, 'RECEIPT', group), /不匹配/);
});
test('当时未拍的历史标记不因现在补拍而消失，也不伪造过去时间', () => {
  const { record } = prepare(), group = W.startGroup(record, 'before');
  W.markMissed(record, 'EMPTY_COMPARTMENT', group, W.DRIVER);
  const originalMark = record.missed[`${group.id}:EMPTY_COMPARTMENT`];
  const { saved } = photo(record, group, 'EMPTY_COMPARTMENT');
  assert.equal(record.missed[`${group.id}:EMPTY_COMPARTMENT`], originalMark);
  assert(W.missing(record).some(item => item.type === 'EMPTY_COMPARTMENT' && item.missed));
  assert.equal(saved.captureTime, '2026-11-21T03:00:00.000Z');
});
test('换协助者只影响新照片上传者，原照片操作者不改写', () => {
  const { record } = prepare(), group = W.startGroup(record, 'unload');
  const first = photo(record, group, 'UNLOAD_CARGO').saved, event = W.ensureEvent(record, 'UNLOAD_CARGO', group);
  const second = W.attachPhoto(record, event, { id: W.id('photo'), status: 'ready', captureTime: W.now() }, W.HELPER);
  assert.equal(first.uploader.id, W.DRIVER.id); assert.equal(second.uploader.id, W.HELPER.id);
});
test('老原型数据增量升级，不合并旧开箱事件或删除旧照片', () => {
  const old = { records: [{ id: 'old', no: 'OLD', plate: '粤B12345', createdAt: '2026-11-20T01:00:00Z',
    events: [{ id: 'open-1', type: 'DOOR_OPEN', photos: [{ id: 'old-photo', status: 'failed' }] }, { id: 'open-2', type: 'DOOR_OPEN', photos: [] }] }] };
  W.normalize(old);
  assert.equal(old.records[0].events.length, 2);
  assert.equal(old.records[0].events[0].photos[0].record_id, 'old');
  assert.equal(old.records[0].events[0].photos[0].uploader.id, 'legacy');
});

function readyTrip() {
  const prepared = prepare();
  W.BASE.forEach(type => photo(prepared.record, null, type));
  W.submitBase(prepared.record);
  return prepared;
}
test('新流程仅三项基础必拍，额外温度空厢不默认欠缺', () => {
  const { record } = prepare();
  assert.deepEqual(W.missing(record).map(entry => entry.type), W.BASE);
  assert.throws(() => W.submitBase(record), /三项/);
  assert.throws(() => W.startGroup(record, 'door'), /运输前/);
  W.BASE.forEach(type => photo(record, null, type));
  assert.throws(() => W.startGroup(record, 'door'), /提交/);
  W.submitBase(record);
  assert.equal(W.missing(record).length, 0);
  assert.doesNotThrow(() => W.startGroup(record, 'door'));
});
test('开门未归档不能先关门，返回与重试均沿用本次分组', () => {
  const { record } = readyTrip(), group = W.startGroup(record, 'door');
  assert.throws(() => W.ensureEvent(record, 'DOOR_CLOSE', group), /开门照片/);
  const { saved } = photo(record, group, 'DOOR_OPEN', 'failed');
  assert.equal(W.startGroup(record, 'door'), group);
  assert.throws(() => W.ensureEvent(record, 'DOOR_CLOSE', group), /开门照片/);
  saved.status = 'ready';
  photo(record, group, 'DOOR_CLOSE');
  assert.equal(record.groups.length, 1);
  assert.equal(saved.group_id, group.id);
});
test('每次开关门均必拍，不能用缺项标记绕过', () => {
  const { record } = readyTrip(), group = W.startGroup(record, 'door');
  photo(record, group, 'DOOR_OPEN');
  assert.throws(() => W.finishDoor(record, group, W.DRIVER), /均须/);
  assert.throws(() => W.markMissed(record, 'DOOR_CLOSE', group, W.DRIVER), /不能跳过/);
  assert.throws(() => W.markMissed(record, 'WAYBILL', null, W.DRIVER), /不能跳过/);
  assert(W.missing(record).some(entry => entry.type === 'DOOR_CLOSE' && entry.group_id === group.id));
});
test('保存本次不会完成运输，再次开门新建独立编号', () => {
  const { record } = readyTrip(), first = W.startGroup(record, 'door');
  W.GROUPS.door.types.forEach(type => photo(record, first, type));
  W.finishDoor(record, first, W.DRIVER); W.finishDoor(record, first, W.DRIVER);
  assert.equal(record.audit.filter(entry => entry.type === 'door_finished').length, 1);
  assert.equal(record.deliveryConfirmedAt, null);
  const second = W.startGroup(record, 'door');
  assert.notEqual(second.id, first.id); assert.equal(second.sequence, 2);
  assert.throws(() => W.completeTransport(record, W.DRIVER), /未完成/);
});
test('完成运输须提交基础和保存全部开关门，额外待传也不能静默丢失', () => {
  const { record } = readyTrip();
  assert.throws(() => W.completeTransport(record, W.DRIVER), /最后卸货/);
  const group = W.startGroup(record, 'door');
  W.GROUPS.door.types.forEach(type => photo(record, group, type));
  assert.throws(() => W.completeTransport(record, W.DRIVER), /未完成/);
  const pending = photo(record, group, 'DOOR_CLOSE', 'watermark_failed').saved;
  assert.throws(() => W.finishDoor(record, group, W.DRIVER), /待处理/);
  pending.status = 'ready'; W.finishDoor(record, group, W.DRIVER);
  const issue = W.startGroup(record, 'issue'), queued = photo(record, issue, 'ISSUE_WIDE', 'queued').saved;
  assert.throws(() => W.completeTransport(record, W.DRIVER), /待上传/);
  queued.status = 'ready';
  W.completeTransport(record, W.DRIVER); W.completeTransport(record, W.DRIVER);
  assert.equal(record.audit.filter(entry => entry.type === 'delivery_confirmed').length, 1);
  assert.equal(record.finalGroupId, group.id);
  assert.throws(() => W.startGroup(record, 'door'), /已完成运输/);
});
test('确认完成后纠正保留记录，继续运输的下一次开门不复用旧组', () => {
  const { record } = readyTrip(), group = W.startGroup(record, 'door');
  W.GROUPS.door.types.forEach(type => photo(record, group, type));
  W.finishDoor(record, group, W.DRIVER); W.completeTransport(record, W.DRIVER);
  const confirmation = record.deliveryConfirmedAt;
  W.correctDelivery(record, W.DRIVER, '还有货要送');
  assert.equal(record.audit.at(-1).previous_confirmed_at, confirmation);
  assert.equal(W.startGroup(record, 'door').sequence, 2);
});
test('问题可在运输前单独写说明，返回不丢记录，另一次单独保存', () => {
  const { record } = prepare(), group = W.startGroup(record, 'issue');
  W.saveIssueNote(record, group, '运单上的件数需要核实', W.DRIVER);
  assert.equal(W.cancelEmptyGroup(record, group), false);
  assert.equal(group.notes[0].actor.id, W.DRIVER.id);
  assert.equal(group.notes[0].text, '运单上的件数需要核实');
  group.completedAt = W.now();
  assert.equal(W.startGroup(record, 'issue').sequence, 2);
});
