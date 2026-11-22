const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, config, NOW } = require('./helpers/transport-v1.cjs');
const { createQueue } = require('../tools/workflow-probe/miniprogram/lib/photo-queue');
const { view } = require('../tools/workflow-probe/miniprogram/lib/view');
async function fixture() {
  const h = setup(), recordId = await h.trip(), eventId = await h.event(recordId, 'base', 'WAYBILL');
  const storage = new Map(), removed = [], calls = [], source = Buffer.from('camera original');
  let seq = 0;
  const platform = {
    getStorageSync: key => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    getFileSystemManager: () => ({
      saveFile: ({ success }) => success({ savedFilePath: `saved-camera-${++seq}` }),
      removeSavedFile: ({ filePath }) => removed.push(filePath),
    }),
    uploadFile: ({ formData, success }) => {
      const fileID = `cloud://${config.environment}.test-bucket/${formData.key}`;
      h.files.set(fileID, Buffer.from(source));
      process.nextTick(() => success({ statusCode: 204 }));
      return { abort() {} };
    },
  };
  let responder = input => h.ok(input);
  const options = { platform, requestId: h.request, recordId,
    call: async input => { calls.push(structuredClone(input)); return responder(input); } };
  const queue = createQueue(options);
  const add = () => queue.add({ size: source.length, tempFilePath: 'camera-tmp' },
    { id: eventId, name: '货运单' }, 'WAYBILL', NOW);
  return { h, recordId, storage, removed, calls, platform, queue, options, add,
    respond: fn => { responder = fn; } };
}
test('断网时原图与请求先落盘，重新创建队列仍能上传同一张', async () => {
  const f = await fixture(), draft = await f.add();
  f.respond(async () => { throw new Error('offline'); });
  await assert.rejects(f.queue.send(draft.id), /offline/);
  assert.equal(f.queue.list().length, 1);
  assert.equal(f.removed.length, 0);
  const restored = createQueue(f.options);
  f.respond(input => f.h.ok(input));
  assert.equal((await restored.send(draft.id)).status, 'ready');
  assert.equal(restored.list().length, 0);
  assert.equal(f.removed.length, 1);
  assert.equal(f.h.docs('photos')[0].capture_time, NOW);
});
test('预留响应丢失后重试复用照片请求，最终只保留一个照片记录', async () => {
  const f = await fixture(), draft = await f.add();
  let lost = false;
  f.respond(async input => {
    const result = await f.h.ok(input);
    if (input.action === 'reservePhoto' && !lost) { lost = true; throw new Error('lost reserve response'); }
    return result;
  });
  await assert.rejects(f.queue.send(draft.id));
  assert.equal(f.queue.list()[0].photo_id, null);
  await createQueue(f.options).send(draft.id);
  assert.equal(f.h.docs('photos').length, 1);
  assert.equal(f.h.docs('records')[0].photo_count, 1);
  assert.equal(new Set(f.calls.filter(c => c.action === 'reservePhoto').map(c => c.request_id)).size, 1);
});
test('上传响应丢失重复上传同一目标，原图和拍摄元数据保持不变', async () => {
  const f = await fixture(), draft = await f.add(), originalUpload = f.platform.uploadFile;
  const paths = [];
  f.platform.uploadFile = input => {
    paths.push(input.formData.key);
    return originalUpload({ ...input, success: result => {
      if (paths.length === 1) input.fail(new Error('lost upload response'));
      else input.success(result);
    } });
  };
  await assert.rejects(f.queue.send(draft.id));
  await f.queue.send(draft.id);
  assert.equal(paths.length, 2); assert.equal(paths[0], paths[1]);
  assert.equal(f.h.docs('photos')[0].capture_time, NOW);
});
test('临时上传授权过期时保留照片，重试重新签发；签名和临时凭据不写入手机草稿', async () => {
  const f = await fixture(), draft = await f.add(), originalUpload = f.platform.uploadFile;
  f.platform.uploadFile = ({ success }) => { success({ statusCode: 403 }); return { abort() {} }; };
  await assert.rejects(f.queue.send(draft.id), /上传授权/);
  assert.equal(f.removed.length, 0);
  assert(!JSON.stringify(f.queue.list()).includes('synthetic-upload'));
  f.platform.uploadFile = originalUpload;
  await f.queue.send(draft.id);
  assert.equal(f.calls.filter(c => c.action === 'uploadTarget').length, 2);
  assert.equal(f.h.docs('photos').length, 1);
});
test('归档响应丢失后手机保留草稿，重试不重复计数，确认ready才清理', async () => {
  const f = await fixture(), draft = await f.add();
  let lost = false;
  f.respond(async input => {
    const data = await f.h.ok(input);
    if (input.action === 'processPhoto' && !lost) { lost = true; throw new Error('lost process response'); }
    return data;
  });
  await assert.rejects(f.queue.send(draft.id));
  assert.equal(f.queue.list().length, 1); assert.equal(f.removed.length, 0);
  await createQueue(f.options).send(draft.id);
  assert.equal(f.h.docs('records')[0].photo_count, 1);
  assert.equal(f.queue.list().length, 0); assert.equal(f.removed.length, 1);
});
test('水印失败和仍在处理都保留草稿，不提示成功或删除原图', async () => {
  const f = await fixture(), draft = await f.add(), render = f.h.media.render;
  f.h.media.render = async () => { throw new Error('FONT_UNAVAILABLE'); };
  assert.equal((await f.queue.send(draft.id)).status, 'watermark_failed');
  assert.equal(f.queue.list().length, 1); assert.equal(f.removed.length, 0);
  f.respond(async input => input.action === 'processPhoto' ? { photo: { status: 'processing' } } : f.h.ok(input));
  assert.equal((await f.queue.send(draft.id)).status, 'processing');
  assert.equal(f.removed.length, 0);
  f.respond(input => f.h.ok(input)); f.h.media.render = render;
  await f.queue.send(draft.id); assert.equal(f.removed.length, 1);
});
test('预留响应丢失后移除，先恢复云端照片再移除；断网不能提前删本机文件', async () => {
  const f = await fixture(), draft = await f.add();
  f.respond(async input => { await f.h.ok(input); throw new Error('lost'); });
  await assert.rejects(f.queue.send(draft.id));
  f.respond(async () => { throw new Error('offline'); });
  await assert.rejects(f.queue.discard(draft.id, '取消误拍'));
  assert.equal(f.removed.length, 0);
  f.respond(input => f.h.ok(input));
  await f.queue.discard(draft.id, '取消误拍');
  assert.equal(f.h.docs('photos').length, 1);
  assert(f.h.docs('photos')[0].removed_at);
  assert.equal(f.h.docs('records')[0].pending_count, 0);
  assert.equal(f.removed.length, 1);
});
test('本机未上传草稿也阻止完成运输；展示按事件号排序且不含已移除照片', () => {
  const state = {
    phase: 'transporting', base_ready: { WAYBILL: 1, CARGO_PHOTO: 1, LOADED_COMPARTMENT: 1 },
    active_door: null, closed_door_count: 1, pending_count: 0,
    events: [2, 1].map(n => ({ id: `door${n}`, kind: 'door', event_no: n, ready_by_type: { DOOR_OPEN: 1, DOOR_CLOSE: 1 }, pending_count: 0 })),
    photos: [{ id: 'removed', event_id: 'door1', type: 'DOOR_OPEN', removed_at: NOW }],
  };
  assert.equal(view(state, []).canComplete, true);
  const result = view(state, [{ id: 'local-pending', type: 'ISSUE' }]);
  assert.equal(result.canComplete, false);
  assert.deepEqual(result.doors.map(e => e.id), ['door1', 'door2']);
  assert.equal(result.doors[0].photos.length, 0);
});
test('只拍齐第一项时下一项解锁，第三项仍锁住；完成运输后拍照全部锁住', () => {
  const state = { phase: 'preparing', base_ready: { WAYBILL: 1 }, events: [], photos: [] };
  assert.deepEqual(view(state, []).base.map(b => b.locked), [false, false, true]);
  assert(view({ ...state, phase: 'completed' }, []).base.every(b => b.locked));
});
