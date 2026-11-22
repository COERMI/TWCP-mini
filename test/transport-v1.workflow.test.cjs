const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, config, actor, NOW, COLLECTIONS } = require('./helpers/transport-v1.cjs');
const { LEASE_MS, MAX_BYTES } = require('../cloudfunctions/transportV1/workflow');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const refused = async (h, action, record_id, input, code, context) => {
  const result = await h.call({ action, record_id, request_id: h.request(), ...input }, context);
  assert.equal(result.code, code, `${action}: ${JSON.stringify(result)}`);
};
test('三项严格按归档成功解锁，客户端无法伪造ready，未齐或待处理不能提交', async () => {
  const h = setup(), id = await h.trip();
  await refused(h, 'startEvent', id, { kind: 'base', type: 'CARGO_PHOTO' }, 'BASE_ORDER');
  await refused(h, 'startEvent', id, { kind: 'door' }, 'BASE_NOT_SUBMITTED');
  const e = await h.event(id, 'base', 'WAYBILL');
  const p = await h.reserve(id, e, 'WAYBILL', { status: 'ready' });
  assert.equal(p.photo.status, 'pending_upload');
  await refused(h, 'startEvent', id, { kind: 'base', type: 'CARGO_PHOTO' }, 'BASE_ORDER');
  await refused(h, 'submitBase', id, {}, 'BASE_INCOMPLETE');
  await h.process(id, p);
  await h.base(id);
  const extra = await h.reserve(id, e, 'WAYBILL');
  const other = await h.trip();
  for (const t of ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT']) await h.photo(other, await h.event(other, 'base', t), t);
  await h.reserve(other, await h.event(other, 'base', 'WAYBILL'), 'WAYBILL');
  await refused(h, 'submitBase', other, {}, 'PHOTOS_PENDING');
  assert.equal(extra.photo.status, 'pending_upload');
});
test('固定事件及并发预留幂等，改元数据或跨动作重用请求号拒绝', async () => {
  const h = setup(), id = await h.trip();
  const events = await Promise.all(Array.from({ length: 8 }, () => h.event(id, 'base', 'WAYBILL')));
  assert.equal(new Set(events).size, 1);
  const input = { action: 'reservePhoto', record_id: id, event_id: events[0], type: 'WAYBILL', capture_time: NOW, request_id: h.request() };
  const responses = await Promise.all(Array.from({ length: 8 }, () => h.ok(input)));
  assert.equal(new Set(responses.map(r => r.photo.id)).size, 1);
  assert.equal(h.docs('records')[0].pending_count, 1);
  assert.equal((await h.call({ ...input, capture_time: NOW - 1 })).code, 'REQUEST_CONFLICT');
  assert.equal((await h.call({ ...input, action: 'submitBase' })).code, 'REQUEST_CONFLICT');
});
test('重复处理与响应丢失后重试只归档和计数一次', async () => {
  const h = setup(), id = await h.trip(), e = await h.event(id, 'base', 'WAYBILL'), p = await h.reserve(id, e, 'WAYBILL');
  const lock = deferred(), reached = deferred(), render = h.media.render;
  h.media.render = async (...args) => { reached.resolve(); await lock.promise; return render(...args); };
  const first = h.process(id, p);
  await reached.promise;
  assert.equal((await h.process(id, p)).photo.status, 'processing');
  lock.resolve(); assert.equal((await first).photo.status, 'ready');
  assert.equal((await h.process(id, p)).photo.status, 'ready');
  assert.equal(h.docs('records')[0].photo_count, 1);
  assert.equal(h.docs('records')[0].pending_count, 0);
  assert.equal(h.docs('audit').filter(a => a.action === 'photo_ready').length, 1);
});
test('水印失败保留原图，上传源被覆盖后重试仍使用首次归档原图和首次时间', async () => {
  const h = setup(), id = await h.trip(), p = await h.reserve(id, await h.event(id, 'base', 'WAYBILL'), 'WAYBILL');
  const render = h.media.render; h.media.render = async () => { throw new Error('FONT_UNAVAILABLE'); };
  assert.equal((await h.process(id, p, Buffer.from('first'))).photo.status, 'watermark_failed');
  const before = h.docs('photos')[0];
  assert(before.original_file_id); assert.equal(before.ready_at, null);
  assert.equal(h.docs('records')[0].photo_count || 0, 0);
  h.advance(10000); let used;
  h.media.render = async (buffer, context) => { used = { buffer, context }; return render(buffer, context); };
  assert.equal((await h.process(id, p, Buffer.from('replaced'))).photo.status, 'ready');
  assert.equal(used.buffer.toString(), 'first');
  assert.equal(used.context.receivedAt, before.received_at);
  assert.equal(used.context.captureTime, NOW);
});
test('过期处理租约可恢复，旧工作者无法覆盖新结果和重复增数', async () => {
  const h = setup(), id = await h.trip(), p = await h.reserve(id, await h.event(id, 'base', 'WAYBILL'), 'WAYBILL');
  const gate = deferred(), reached = deferred(), render = h.media.render;
  let attempts = 0;
  h.media.render = async (...args) => { if (++attempts === 1) { reached.resolve(); await gate.promise; } return render(...args); };
  const original = h.process(id, p).catch(e => e);
  await reached.promise; h.advance(LEASE_MS + 1);
  assert.equal((await h.process(id, p)).photo.status, 'ready');
  gate.resolve();
  const old = await original;
  assert.match(old.message, /PROCESS_SUPERSEDED/);
  assert.equal(h.docs('photos')[0].status, 'ready');
  assert.equal(h.docs('records')[0].photo_count, 1);
});
test('跨环境、跨照片文件键及非云文件拒绝，归档前无下载', async () => {
  const h = setup(), id = await h.trip(), p = await h.reserve(id, await h.event(id, 'base', 'WAYBILL'), 'WAYBILL');
  for (const file_id of ['https://example.invalid/photo', `cloud://other.bucket/${p.cloud_path}`,
    `cloud://${config.environment}.bucket/${p.cloud_path}-other`]) {
    await refused(h, 'processPhoto', id, { photo_id: p.photo.id, file_id }, 'INVALID_FILE');
  }
  assert.equal(h.downloads.length, 0);
});
test('临时上传目标仅签发预留路径，归档后不再签发，移除后拒绝', async () => {
  const h = setup(), id = await h.trip(), p = await h.reserve(id, await h.event(id, 'issue'), 'ISSUE');
  const grant = await h.ok({ action: 'uploadTarget', record_id: id, photo_id: p.photo.id, cloud_path: 'forged-target' });
  assert.equal(grant.target.form_data.key, p.cloud_path);
  await h.process(id, p);
  assert.equal((await h.ok({ action: 'uploadTarget', record_id: id, photo_id: p.photo.id })).archived, true);
  await h.mutate('removePhoto', id, { photo_id: p.photo.id, reason: '误拍' });
  await refused(h, 'uploadTarget', id, { photo_id: p.photo.id }, 'PHOTO_REMOVED');
});
test('所有司机读写入口拒绝其他司机及请求伪造身份，事件和照片不得跨趟', async () => {
  const h = setup(), a = await h.trip(), b = await h.trip('driver-b');
  const e = await h.event(a, 'base', 'WAYBILL'), p = await h.reserve(a, e, 'WAYBILL');
  const validInputs = {
    startEvent: { kind: 'issue' }, reservePhoto: { event_id: e, type: 'ISSUE' },
    uploadTarget: { photo_id: p.photo.id },
    processPhoto: { photo_id: p.photo.id }, removePhoto: { photo_id: p.photo.id, reason: 'wrong photo' },
    submitBase: {}, finishDoor: { event_id: e }, cancelDoor: { event_id: e },
    saveIssue: { event_id: e, note: 'issue' }, completeTrip: { confirm_all_unloaded: true },
    reopenTrip: { reason: 'correction' }, getWorkflow: {}, photoLinks: { photo_id: p.photo.id },
  };
  for (const [action, input] of Object.entries(validInputs)) {
    await refused(h, action, a, input, 'FORBIDDEN', actor('driver-b'));
    await refused(h, action, a, { ...input, OPENID: 'driver-a', APPID: config.appId }, 'IDENTITY_REQUIRED', { ENV: config.environment });
  }
  await refused(h, 'reservePhoto', b, { event_id: e, type: 'WAYBILL' }, 'INVALID_EVENT', actor('driver-b'));
  await refused(h, 'processPhoto', b, { photo_id: p.photo.id }, 'INVALID_PHOTO', actor('driver-b'));
});
test('图片过大或下载失败不增加成功数量，失败可移除并恢复待处理计数', async () => {
  const h = setup(), id = await h.trip(), p = await h.reserve(id, await h.event(id, 'base', 'WAYBILL'), 'WAYBILL');
  assert.equal((await h.process(id, p, Buffer.alloc(MAX_BYTES + 1))).photo.error, 'IMAGE_BYTES_LIMIT');
  assert.equal(h.docs('photos')[0].original_file_id, null);
  await h.mutate('removePhoto', id, { photo_id: p.photo.id, reason: '重新拍摄' });
  assert.equal(h.docs('records')[0].pending_count, 0);
  assert.equal(h.docs('records')[0].base_pending.WAYBILL, 0);
  await refused(h, 'processPhoto', id, { photo_id: p.photo.id }, 'PHOTO_REMOVED');
});
test('后续类别已有待传照片时，前一类最后一张也必须先成功补拍', async () => {
  const h = setup(), id = await h.trip(), waybill = await h.event(id, 'base', 'WAYBILL');
  const first = await h.photo(id, waybill, 'WAYBILL');
  await h.reserve(id, await h.event(id, 'base', 'CARGO_PHOTO'), 'CARGO_PHOTO');
  await refused(h, 'removePhoto', id, { photo_id: first, reason: '重拍' }, 'REPLACEMENT_REQUIRED');
  const replacement = await h.reserve(id, waybill, 'WAYBILL');
  await refused(h, 'removePhoto', id, { photo_id: first, reason: '重拍' }, 'REPLACEMENT_REQUIRED');
  await h.process(id, replacement);
  await h.mutate('removePhoto', id, { photo_id: first, reason: '模糊照片替换' });
  assert.equal(h.docs('records')[0].base_ready.WAYBILL, 1);
  assert.equal(h.docs('audit').find(a => a.action === 'remove_photo').reason, '模糊照片替换');
});
test('并发移除已提交类别两张照片只能成功一张，留下成功归档记录', async () => {
  const h = setup(), id = await h.trip(), originals = await h.base(id);
  const replacement = await h.photo(id, await h.event(id, 'base', 'WAYBILL'), 'WAYBILL');
  const results = await Promise.all([originals[0], replacement].map(photo_id => h.call({
    action: 'removePhoto', record_id: id, request_id: h.request(), photo_id, reason: '重拍替换',
  })));
  assert.equal(results.filter(r => r.success).length, 1);
  assert.equal(results.find(r => !r.success).code, 'REPLACEMENT_REQUIRED');
  assert.equal(h.docs('records')[0].base_ready.WAYBILL, 1);
});
test('一次开关门多图复用同组；关门需开门归档；连续两次独立编号，关门不结束运输', async () => {
  const h = setup(), id = await h.trip(); await h.base(id);
  const e = await h.event(id, 'door');
  assert.equal(await h.event(id, 'door'), e);
  await refused(h, 'reservePhoto', id, { event_id: e, type: 'DOOR_CLOSE' }, 'DOOR_ORDER');
  for (let i = 0; i < 3; i++) await h.photo(id, e, 'DOOR_OPEN');
  await refused(h, 'finishDoor', id, { event_id: e }, 'DOOR_INCOMPLETE');
  await h.photo(id, e, 'DOOR_CLOSE');
  await h.mutate('finishDoor', id, { event_id: e });
  await h.door(id);
  const groups = h.docs('events').filter(e => e.kind === 'door');
  assert.deepEqual(groups.map(e => e.sequence), [1, 2]);
  assert.equal(groups[0].ready_by_type.DOOR_OPEN, 3);
  assert.equal(h.docs('records')[0].phase, 'transporting');
});
test('关门待传即保护开门最后一张；已保存开关门组补拍未就绪不能完成', async () => {
  const h = setup(), id = await h.trip(); await h.base(id);
  const e = await h.event(id, 'door'), open = await h.photo(id, e, 'DOOR_OPEN'), close = await h.reserve(id, e, 'DOOR_CLOSE');
  await refused(h, 'removePhoto', id, { photo_id: open, reason: '替换' }, 'REPLACEMENT_REQUIRED');
  await h.process(id, close); await h.mutate('finishDoor', id, { event_id: e });
  await refused(h, 'removePhoto', id, { photo_id: close.photo.id, reason: '替换' }, 'REPLACEMENT_REQUIRED');
  await h.reserve(id, e, 'DOOR_OPEN');
  await refused(h, 'completeTrip', id, { confirm_all_unloaded: true }, 'PHOTOS_PENDING');
});
test('误建空开关门可取消并保留审计，取消不充当实际卸货组', async () => {
  const h = setup(), id = await h.trip(); await h.base(id);
  const e = await h.event(id, 'door');
  await h.mutate('cancelDoor', id, { event_id: e });
  await refused(h, 'reservePhoto', id, { event_id: e, type: 'DOOR_OPEN' }, 'EVENT_CANCELLED');
  await refused(h, 'completeTrip', id, { confirm_all_unloaded: true }, 'DOOR_INCOMPLETE');
  const group = await h.door(id);
  assert.equal(h.docs('events').find(e => e._id === group.id).sequence, 2);
  await refused(h, 'cancelDoor', id, { event_id: group.id }, 'EVENT_NOT_EMPTY');
  await h.mutate('completeTrip', id, { confirm_all_unloaded: true });
  assert.equal(h.docs('audit').filter(a => a.action === 'cancel_empty_door').length, 1);
});
test('完成需显式确认且最后卸货开关门齐全；完成后补拍先纠正，保留原完成审计', async () => {
  const h = setup(), id = await h.trip(); await h.base(id);
  await refused(h, 'completeTrip', id, {}, 'CONFIRM_REQUIRED');
  await refused(h, 'completeTrip', id, { confirm_all_unloaded: true }, 'DOOR_INCOMPLETE');
  await h.door(id);
  const input = { action: 'completeTrip', record_id: id, request_id: h.request(), confirm_all_unloaded: true };
  const completed = await h.ok(input); h.advance(1000);
  assert.equal((await h.ok(input)).completed_at, completed.completed_at);
  await refused(h, 'startEvent', id, { kind: 'issue' }, 'TRIP_CLOSED');
  await refused(h, 'reopenTrip', id, {}, 'REASON_REQUIRED');
  await h.mutate('reopenTrip', id, { reason: '尚有一处卸货未完成' });
  assert.equal(h.docs('audit').find(a => a.action === 'correct_completion').previous_completed_at, completed.completed_at);
  const e = await h.event(id, 'door');
  await refused(h, 'completeTrip', id, { confirm_all_unloaded: true }, 'DOOR_INCOMPLETE');
  assert.equal(h.docs('records')[0].active_door, e);
});
test('问题支持纯文字和照片，修改说明审计保留旧内容；私有签链只提供归档图', async () => {
  const h = setup(), id = await h.trip();
  const e = (await h.mutate('startEvent', id, { kind: 'issue', note: '第一条说明' })).event.id;
  await h.mutate('saveIssue', id, { event_id: e, note: '补充后的说明' });
  assert.equal(h.docs('audit').find(a => a.action === 'save_issue_note').previous_note, '第一条说明');
  const reserved = await h.reserve(id, e, 'ISSUE');
  await refused(h, 'photoLinks', id, { photo_id: reserved.photo.id }, 'PHOTO_NOT_ARCHIVED');
  await h.process(id, reserved);
  const links = await h.ok({ action: 'photoLinks', record_id: id, photo_id: reserved.photo.id });
  assert(links.original_url && links.watermarked_url);
  await h.mutate('removePhoto', id, { photo_id: reserved.photo.id, reason: '误拍' });
  await refused(h, 'photoLinks', id, { photo_id: reserved.photo.id }, 'PHOTO_REMOVED');
});
test('事件超过一页完整读取，响应不泄露文件ID、身份或签发凭据', async () => {
  const h = setup(), id = await h.trip();
  for (let i = 0; i < 53; i++) await h.event(id, 'issue');
  const a = await h.ok({ action: 'getWorkflow', record_id: id });
  const b = await h.ok({ action: 'getWorkflow', record_id: id, cursor: a.next_cursor });
  assert.equal(a.items.length, 50); assert.equal(b.items.length, 3);
  assert.equal(new Set([...a.items, ...b.items].map(e => e.id)).size, 53);
  assert.equal(b.next_cursor, null);
  assert(!/owner_openid|invite_salt|file_id/.test(JSON.stringify(a)));
  await refused(h, 'getWorkflow', id, { cursor: { $gt: '' } }, 'INVALID_CURSOR');
});
test('真实Sharp渲染可嵌入业务归档，水印含本趟及事件且计数一次', async () => {
  const h = setup(), id = await h.trip();
  const sharp = require('../cloudfunctions/imagePipelineProbe/node_modules/sharp');
  const renderer = require('../cloudfunctions/imagePipelineProbe/renderer');
  h.media.render = renderer.render;
  const input = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#efefef' } }).jpeg().toBuffer();
  const p = await h.reserve(id, await h.event(id, 'base', 'WAYBILL'), 'WAYBILL');
  const result = await h.process(id, p, input);
  assert.equal(result.photo.status, 'ready');
  const saved = h.docs('photos')[0], output = await sharp(h.files.get(saved.watermarked_file_id)).metadata();
  assert.equal(output.width, 640); assert(output.height > 480); assert.equal(output.format, 'png');
  assert.equal(saved.version, renderer.VERSION); assert.equal(h.docs('records')[0].photo_count, 1);
});
