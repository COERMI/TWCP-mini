'use strict';
const crypto = require('node:crypto');
const A = require('./auth');
const BASE = ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT'];
const LABELS = { WAYBILL: '货运单', CARGO_PHOTO: '货物码放', LOADED_COMPARTMENT: '装好的车厢',
  DOOR_OPEN: '开门', DOOR_CLOSE: '关门', ISSUE: '问题照片' };
const MAX_BYTES = 20 * 1024 * 1024;
const LEASE_MS = 90 * 1000;
const count = (map, key) => (map && map[key]) || 0;
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const photoView = p => ({
  id: p._id, event_id: p.event_id, type: p.type, status: p.status, removed_at: p.removed_at,
  created_at: p.created_at,
  capture_time: p.capture_time, received_at: p.received_at, ready_at: p.ready_at, error: p.error,
  original_bytes: p.original_bytes || null, output_bytes: p.output_bytes || null, version: p.version || null,
});
const eventView = e => ({
  id: e._id, kind: e.kind, type: e.type, event_no: e.event_no, sequence: e.sequence, name: e.name,
  status: e.status, ready_by_type: e.ready_by_type, pending_count: e.pending_count,
  note: e.note, created_at: e.created_at, closed_at: e.closed_at,
});
function makeWorkflow({ store, config, clock, collections: C, media }) {
  const read = (tx, kind, id) => tx.get(C[kind], id);
  const write = (tx, kind, data) => tx.set(C[kind], data._id, data);
  function recordId(id) {
    if (typeof id !== 'string' || !/^trip_[a-f0-9]{40}$/.test(id)) A.fail('INVALID_RECORD', '缺少本趟运输编号');
    return id;
  }
  async function owned(tx, input, actor) {
    const r = await read(tx, 'records', recordId(input.record_id));
    if (!r || !r.owner_openid || r.owner_openid !== actor.id) A.fail('FORBIDDEN', '无权操作这趟运输');
    return r;
  }
  function active(r) {
    if (!['preparing', 'transporting'].includes(r.phase)) A.fail('TRIP_CLOSED', '本趟已完成，请先纠正完成状态再补充');
  }
  function bump(r) { r.revision++; r.updated_at = clock(); }
  function readyBase(r) { return BASE.every(type => count(r.base_ready, type) > 0); }
  async function audit(tx, id, r, actor, action, details = {}) {
    await write(tx, 'audit', { _id: id, record_id: r._id, actor_id: actor.id, actor_kind: 'driver',
      action, at: clock(), revision: r.revision, ...details });
  }
  // Every mutation uses a scoped, persistent request receipt. All database work is
  // inside a transaction; cloud file operations never run in retried callbacks.
  async function mutate(input, context, payload, work) {
    const actor = A.driver(context, config), key = A.requestId(input.request_id);
    const id = `workflow_${A.sha(`${actor.id}:${key}`)}`;
    const fingerprint = A.sha(JSON.stringify({ action: input.action, record_id: input.record_id, ...payload }));
    return store.transaction(async tx => {
      const r = await owned(tx, input, actor);
      const receipt = await read(tx, 'requests', id);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) A.fail('REQUEST_CONFLICT', '同一请求不能改为其他操作，请刷新后重试');
        return receipt.result;
      }
      const result = await work(tx, r, actor, id);
      await write(tx, 'requests', { _id: id, record_id: r._id, fingerprint, result, created_at: clock() });
      return result;
    });
  }
  async function eventFor(tx, r, id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_]{12,120}$/.test(id)) A.fail('INVALID_EVENT', '缺少有效拍摄记录');
    const e = await read(tx, 'events', id);
    if (!e || e.record_id !== r._id) A.fail('INVALID_EVENT', '拍摄记录不属于本趟运输');
    return e;
  }
  async function photoFor(tx, r, id) {
    if (typeof id !== 'string' || !/^photo_[a-f0-9]{64}$/.test(id)) A.fail('INVALID_PHOTO', '缺少有效照片编号');
    const p = await read(tx, 'photos', id);
    if (!p || p.record_id !== r._id) A.fail('INVALID_PHOTO', '照片不属于本趟运输');
    return p;
  }
  async function startEvent(input, context) {
    const kind = input.kind, type = input.type || '';
    const note = A.text(input.note, 301);
    if (!['base', 'door', 'issue'].includes(kind) || (kind === 'base' && !BASE.includes(type)) || note.length > 300) {
      A.fail('INVALID_EVENT', '拍摄记录类型或问题说明不正确');
    }
    return mutate(input, context, { kind, type, note }, async (tx, r, actor, request) => {
      active(r);
      let id;
      if (kind === 'base') {
        const position = BASE.indexOf(type);
        if (!BASE.slice(0, position).every(t => count(r.base_ready, t) > 0)) A.fail('BASE_ORDER', '请先归档前一项必拍照片');
        id = `${r._id}_${type}`;
        const existing = await read(tx, 'events', id);
        if (existing) return { event: eventView(existing) };
      } else if (kind === 'door') {
        if (r.phase !== 'transporting') A.fail('BASE_NOT_SUBMITTED', '请先拍齐并提交运输前三项照片');
        // A second tap, even with another request ID, resumes the current group.
        if (r.active_door) return { event: eventView(await eventFor(tx, r, r.active_door)) };
        id = `event_${A.sha(request)}`;
      } else id = `event_${A.sha(request)}`;
      r.event_count = (r.event_count || 0) + 1;
      let sequence = 0;
      if (kind === 'door') {
        sequence = (r.door_count || 0) + 1; r.door_count = sequence; r.active_door = id;
      }
      if (kind === 'issue') { sequence = (r.issue_count || 0) + 1; r.issue_count = sequence; }
      const e = { _id: id, record_id: r._id, kind, type: kind === 'base' ? type : null,
        event_no: r.event_count, sequence, name: kind === 'base' ? LABELS[type] : `第${sequence}次${kind === 'door' ? '开关门' : '问题记录'}`,
        status: 'open', ready_by_type: {}, pending_by_type: {}, pending_count: 0, note,
        created_at: clock(), closed_at: null };
      bump(r); await write(tx, 'records', r); await write(tx, 'events', e);
      await audit(tx, request, r, actor, 'start_event', { event_id: id });
      return { event: eventView(e) };
    });
  }
  async function reservePhoto(input, context) {
    const type = input.type;
    if (!Object.hasOwn(LABELS, type)) A.fail('INVALID_PHOTO', '不支持的照片类型');
    const capture = input.capture_time == null ? null : input.capture_time;
    if (capture !== null && (!Number.isSafeInteger(capture) || capture < 0 || capture > clock() + 5 * 60000)) {
      A.fail('INVALID_TIME', '拍摄时间不正确，请核对手机时间');
    }
    // This batch records missing location explicitly. Never fabricate an address/weather.
    return mutate(input, context, { event_id: input.event_id, type, capture_time: capture }, async (tx, r, actor, request) => {
      active(r);
      const e = await eventFor(tx, r, input.event_id);
      if (e.status === 'cancelled') A.fail('EVENT_CANCELLED', '这次空记录已取消，请新建开关门记录');
      if ((e.kind === 'base' && e.type !== type) ||
          (e.kind === 'door' && !['DOOR_OPEN', 'DOOR_CLOSE'].includes(type)) ||
          (e.kind === 'issue' && type !== 'ISSUE')) A.fail('INVALID_PHOTO', '照片类型与拍摄记录不一致');
      if (e.kind === 'base' && !BASE.slice(0, BASE.indexOf(type)).every(t => count(r.base_ready, t) > 0)) {
        A.fail('BASE_ORDER', '请先补齐前面的必拍照片');
      }
      if (e.kind === 'door' && type === 'DOOR_CLOSE' && count(e.ready_by_type, 'DOOR_OPEN') < 1) {
        A.fail('DOOR_ORDER', '请先拍摄并归档本次开门照片');
      }
      if ((r.pending_count || 0) >= 50) A.fail('TOO_MANY_PENDING', '待处理照片较多，请先上传或处理现有照片');
      const id = `photo_${A.sha(request)}`;
      if (!config.inviteSecret) A.fail('NOT_CONFIGURED', '上传配置尚未就绪');
      const nonce = crypto.createHmac('sha256', config.inviteSecret).update(`incoming:${actor.id}:${id}`).digest('hex');
      const cloudPath = `transport-v1/incoming/${r._id}/${id}/${nonce}.jpg`;
      const p = { _id: id, record_id: r._id, event_id: e._id, type, uploader_id: actor.id,
        cloud_path: cloudPath, capture_time: capture, created_at: clock(), received_at: null,
        ready_at: null, status: 'pending_upload', removed_at: null, lease_token: null, lease_until: 0,
        original_file_id: null, watermarked_file_id: null, original_sha256: null, error: null };
      e.pending_count++; e.pending_by_type ||= {};
      e.pending_by_type[type] = count(e.pending_by_type, type) + 1;
      r.pending_count = (r.pending_count || 0) + 1;
      if (BASE.includes(type)) { r.base_pending ||= {}; r.base_pending[type] = count(r.base_pending, type) + 1; }
      bump(r);
      await write(tx, 'photos', p); await write(tx, 'events', e); await write(tx, 'records', r);
      await audit(tx, request, r, actor, 'reserve_photo', { photo_id: id, event_id: e._id });
      return { photo: photoView(p), cloud_path: cloudPath, max_bytes: MAX_BYTES };
    });
  }
  function correctFile(fileID, p) {
    if (typeof fileID !== 'string') return false;
    const prefix = `cloud://${config.environment}.`;
    if (!fileID.startsWith(prefix)) return false;
    const slash = fileID.indexOf('/', prefix.length);
    return slash > prefix.length && /^[a-zA-Z0-9-]+$/.test(fileID.slice(prefix.length, slash)) &&
      fileID.slice(slash + 1) === p.cloud_path;
  }
  async function uploadTarget(input, context) {
    const actor = A.driver(context, config);
    const r = await owned(store, input, actor), p = await photoFor(store, r, input.photo_id);
    if (p.removed_at) A.fail('PHOTO_REMOVED', '这张照片已移除');
    if (p.original_file_id || p.status === 'ready') return { archived: true };
    active(r);
    if (!media || !media.signUpload) A.fail('NOT_CONFIGURED', '上传签发尚未配置');
    // Temporary scoped credentials are freshly issued, never stored in receipts.
    return { archived: false, target: await media.signUpload(p.cloud_path) };
  }
  async function processPhoto(input, context) {
    const actor = A.driver(context, config), lease = crypto.randomBytes(24).toString('hex');
    if (!media) A.fail('NOT_CONFIGURED', '图片处理尚未配置');
    const acquired = await store.transaction(async tx => {
      const r = await owned(tx, input, actor), p = await photoFor(tx, r, input.photo_id);
      if (p.removed_at) A.fail('PHOTO_REMOVED', '这张照片已移除');
      if (p.status === 'ready') return { done: true, photo: photoView(p) };
      active(r);
      if (p.lease_until > clock()) return { done: true, photo: photoView(p) };
      if (!p.original_file_id && !correctFile(input.file_id, p)) A.fail('INVALID_FILE', '上传文件不属于这张照片');
      const e = await eventFor(tx, r, p.event_id);
      p.lease_token = lease; p.lease_until = clock() + LEASE_MS; p.status = 'processing'; p.error = null;
      await write(tx, 'photos', p);
      return { r, p, e };
    });
    if (acquired.done) return { photo: acquired.photo };
    const { r, p, e } = acquired;
    const save = callback => store.transaction(async tx => {
      const currentRecord = await owned(tx, input, actor), current = await photoFor(tx, currentRecord, p._id);
      if (current.lease_token !== lease || current.removed_at) A.fail('PROCESS_SUPERSEDED', '图片处理已由重试接续，请刷新');
      return callback(tx, currentRecord, current);
    });
    try {
      // Once archived, retries always read the immutable server-owned original.
      const bytes = await media.download(p.original_file_id || input.file_id);
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new Error('IMAGE_BYTES_LIMIT');
      const sha = hash(bytes);
      if (p.original_sha256 && p.original_sha256 !== sha) throw new Error('ORIGINAL_MISMATCH');
      const archiveRoot = `transport-v1/archive/${r._id}/${p._id}/${sha}`;
      let original = p.original_file_id;
      if (!original) {
        original = await media.upload(`${archiveRoot}/original`, bytes);
        await save(async (tx, record, current) => {
          if (current.original_sha256 && current.original_sha256 !== sha) A.fail('ORIGINAL_MISMATCH', '原图不一致');
          current.original_file_id = original; current.original_sha256 = sha;
          current.archive_identity = 'server_role_v1';
          current.original_bytes = bytes.length; current.received_at ||= clock();
          await write(tx, 'photos', current);
          p.received_at = current.received_at;
        });
      }
      const result = await media.render(bytes, {
        plate: r.plate_number, recordNo: r.record_no, type: p.type,
        eventName: e.kind === 'door' ? `第${e.sequence}次${LABELS[p.type]}` : e.name,
        captureTime: p.capture_time, receivedAt: p.received_at,
        locationText: '定位未采集',
      });
      const derivative = await media.upload(`${archiveRoot}/${result.version}.${result.extension}`, result.buffer);
      return await save(async (tx, record, current) => {
        const currentEvent = await eventFor(tx, record, current.event_id);
        current.watermarked_file_id = derivative; current.watermarked_sha256 = hash(result.buffer);
        current.version = result.version; current.output_bytes = result.buffer.length;
        current.output = result.output; current.status = 'ready'; current.ready_at = clock();
        current.error = null; current.lease_token = null; current.lease_until = 0;
        currentEvent.pending_count--; currentEvent.pending_by_type[current.type]--;
        currentEvent.ready_by_type[current.type] = count(currentEvent.ready_by_type, current.type) + 1;
        record.pending_count--; record.photo_count = (record.photo_count || 0) + 1;
        if (BASE.includes(current.type)) {
          record.base_ready ||= {}; record.base_ready[current.type] = count(record.base_ready, current.type) + 1;
          record.base_pending[current.type]--;
        }
        bump(record);
        await write(tx, 'photos', current); await write(tx, 'events', currentEvent); await write(tx, 'records', record);
        await audit(tx, `archived_${current._id}`, record, actor, 'photo_ready', { photo_id: current._id, event_id: current.event_id });
        return { photo: photoView(current) };
      });
    } catch (error) {
      // Fenced lease prevents an older worker from corrupting a newer result.
      return save(async (tx, record, current) => {
        current.status = current.original_file_id ? 'watermark_failed' : 'upload_failed';
        current.error = ['IMAGE_BYTES_LIMIT', 'IMAGE_FORMAT_UNSUPPORTED', 'IMAGE_TOO_SMALL', 'FONT_UNAVAILABLE', 'ORIGINAL_MISMATCH',
          'ARCHIVE_IDENTITY_UNAVAILABLE', 'ARCHIVE_UPLOAD_FAILED', 'ARCHIVE_UPLOAD_TIMEOUT']
          .includes(error.message) ? error.message : 'PROCESS_FAILED';
        current.lease_token = null; current.lease_until = 0;
        await write(tx, 'photos', current);
        return { photo: photoView(current) };
      });
    }
  }
  async function removePhoto(input, context) {
    const reason = A.text(input.reason, 301);
    if (!reason || reason.length > 300) A.fail('REASON_REQUIRED', '请填写移除原因，不超过300字');
    return mutate(input, context, { photo_id: input.photo_id, reason }, async (tx, r, actor, request) => {
      active(r);
      const p = await photoFor(tx, r, input.photo_id);
      if (p.removed_at) return { photo: photoView(p) };
      if (p.lease_until > clock()) A.fail('PHOTO_PROCESSING', '照片正在处理，请稍后再操作');
      const e = await eventFor(tx, r, p.event_id);
      if (p.status === 'ready') {
        // Preserve prerequisites even before departure if later base categories exist.
        const basePosition = BASE.indexOf(p.type);
        const protectedBase = basePosition >= 0 && (r.phase === 'transporting' ||
          BASE.slice(basePosition + 1).some(t => count(r.base_ready, t) > 0 || count(r.base_pending, t) > 0));
        const protectedDoor = e.kind === 'door' && (e.status === 'closed' ||
          (p.type === 'DOOR_OPEN' && (count(e.ready_by_type, 'DOOR_CLOSE') > 0 || count(e.pending_by_type, 'DOOR_CLOSE') > 0)));
        if ((protectedBase || protectedDoor) && count(e.ready_by_type, p.type) <= 1) {
          A.fail('REPLACEMENT_REQUIRED', '请先补拍同类照片并归档成功，再移除最后一张');
        }
        e.ready_by_type[p.type]--; r.photo_count--;
        if (basePosition >= 0) r.base_ready[p.type]--;
      } else {
        e.pending_count--; e.pending_by_type[p.type]--; r.pending_count--;
        if (BASE.includes(p.type)) r.base_pending[p.type]--;
      }
      p.removed_at = clock(); p.removal_reason = reason; p.lease_token = null; p.lease_until = 0; bump(r);
      await write(tx, 'photos', p); await write(tx, 'events', e); await write(tx, 'records', r);
      await audit(tx, request, r, actor, 'remove_photo', { photo_id: p._id, event_id: e._id, reason });
      return { photo: photoView(p) };
    });
  }
  async function submitBase(input, context) {
    return mutate(input, context, {}, async (tx, r, actor, request) => {
      if (r.phase === 'transporting') return { phase: r.phase };
      active(r);
      if (!readyBase(r)) A.fail('BASE_INCOMPLETE', '请先拍齐并归档运输前三项照片');
      if ((r.pending_count || 0) > 0) A.fail('PHOTOS_PENDING', '还有照片待处理，请先上传、重试或移除');
      r.phase = 'transporting'; r.departed_at = clock(); bump(r);
      await write(tx, 'records', r); await audit(tx, request, r, actor, 'submit_base');
      return { phase: r.phase };
    });
  }
  async function finishDoor(input, context) {
    return mutate(input, context, { event_id: input.event_id }, async (tx, r, actor, request) => {
      active(r);
      const e = await eventFor(tx, r, input.event_id);
      if (e.kind !== 'door') A.fail('INVALID_EVENT', '请选择本次开关门记录');
      if (e.status === 'closed') return { event: eventView(e), phase: r.phase };
      if (r.phase !== 'transporting' || r.active_door !== e._id) A.fail('INVALID_EVENT', '本次开关门状态不一致');
      if (!['DOOR_OPEN', 'DOOR_CLOSE'].every(t => count(e.ready_by_type, t) > 0)) A.fail('DOOR_INCOMPLETE', '本次开门和关门都需要拍照归档');
      if (e.pending_count > 0) A.fail('PHOTOS_PENDING', '本次还有照片待处理');
      e.status = 'closed'; e.closed_at = clock(); r.active_door = null; r.closed_door_count = (r.closed_door_count || 0) + 1;
      bump(r); await write(tx, 'events', e); await write(tx, 'records', r);
      await audit(tx, request, r, actor, 'finish_door', { event_id: e._id });
      return { event: eventView(e), phase: r.phase };
    });
  }
  async function saveIssue(input, context) {
    const note = A.text(input.note, 301);
    if (!note || note.length > 300) A.fail('NOTE_REQUIRED', '请填写1至300字的问题说明');
    return mutate(input, context, { event_id: input.event_id, note }, async (tx, r, actor, request) => {
      active(r);
      const e = await eventFor(tx, r, input.event_id);
      if (e.kind !== 'issue') A.fail('INVALID_EVENT', '请选择问题记录');
      const previous = e.note; e.note = note; bump(r);
      await write(tx, 'events', e); await write(tx, 'records', r);
      await audit(tx, request, r, actor, 'save_issue_note', { event_id: e._id, previous_note: previous, note });
      return { event: eventView(e) };
    });
  }
  async function cancelDoor(input, context) {
    return mutate(input, context, { event_id: input.event_id }, async (tx, r, actor, request) => {
      active(r);
      const e = await eventFor(tx, r, input.event_id);
      if (e.kind !== 'door') A.fail('INVALID_EVENT', '请选择开关门记录');
      if (e.status === 'cancelled') return { event: eventView(e) };
      if (e.status !== 'open' || r.active_door !== e._id ||
          e.pending_count || Object.values(e.ready_by_type).some(n => n > 0)) {
        A.fail('EVENT_NOT_EMPTY', '只能取消没有照片的当前开关门记录');
      }
      e.status = 'cancelled'; e.closed_at = clock(); r.active_door = null;
      r.cancelled_door_count = (r.cancelled_door_count || 0) + 1;
      bump(r); await write(tx, 'events', e); await write(tx, 'records', r);
      await audit(tx, request, r, actor, 'cancel_empty_door', { event_id: e._id });
      return { event: eventView(e) };
    });
  }
  async function completeTrip(input, context) {
    if (input.confirm_all_unloaded !== true) A.fail('CONFIRM_REQUIRED', '请确认全部卸货完毕');
    return mutate(input, context, { confirm_all_unloaded: true }, async (tx, r, actor, request) => {
      if (r.phase === 'completed') return { phase: r.phase, completed_at: r.completed_at };
      if (r.phase !== 'transporting' || !readyBase(r)) A.fail('BASE_NOT_SUBMITTED', '请先拍齐并提交运输前三项照片');
      if (!r.closed_door_count || r.active_door ||
          r.door_count !== r.closed_door_count + (r.cancelled_door_count || 0)) {
        A.fail('DOOR_INCOMPLETE', '最后卸货也要开门关门拍照，请先保存所有开关门记录');
      }
      if (r.pending_count > 0) A.fail('PHOTOS_PENDING', '还有照片待处理，请先补传、重试或移除');
      r.phase = 'completed'; r.completed_at = clock(); bump(r);
      await write(tx, 'records', r); await audit(tx, request, r, actor, 'complete_trip');
      return { phase: r.phase, completed_at: r.completed_at };
    });
  }
  async function reopenTrip(input, context) {
    const reason = A.text(input.reason, 301);
    if (!reason || reason.length > 300) A.fail('REASON_REQUIRED', '请填写纠正完成的原因');
    return mutate(input, context, { reason }, async (tx, r, actor, request) => {
      if (r.phase !== 'completed') A.fail('NOT_COMPLETED', '本趟尚未完成');
      const previous = r.completed_at;
      r.phase = 'transporting'; r.completed_at = null; bump(r);
      await write(tx, 'records', r); await audit(tx, request, r, actor, 'correct_completion', { reason, previous_completed_at: previous });
      return { phase: r.phase };
    });
  }
  async function getWorkflow(input, context) {
    const actor = A.driver(context, config);
    const r = await owned(store, input, actor);
    const kind = input.collection === 'photos' ? 'photos' : 'events';
    const cursor = input.cursor || '';
    if (typeof cursor !== 'string' || cursor.length > 120 || (cursor && !/^[A-Za-z0-9_]+$/.test(cursor))) {
      A.fail('INVALID_CURSOR', '分页位置无效，请刷新');
    }
    const rows = await store.list(C[kind], { record_id: r._id }, cursor, 51);
    const page = rows.slice(0, 50);
    return { phase: r.phase, revision: r.revision, base_ready: r.base_ready || {},
      pending_count: r.pending_count || 0, active_door: r.active_door || null,
      door_count: r.door_count || 0, closed_door_count: r.closed_door_count || 0,
      cancelled_door_count: r.cancelled_door_count || 0,
      collection: kind, items: page.map(kind === 'photos' ? photoView : eventView),
      next_cursor: rows.length > 50 ? page[49]._id : null };
  }
  async function photoLinks(input, context) {
    const actor = A.driver(context, config), r = await owned(store, input, actor);
    const p = await photoFor(store, r, input.photo_id);
    if (p.removed_at) A.fail('PHOTO_REMOVED', '这张照片已移除');
    const files = [p.original_file_id, p.status === 'ready' && p.watermarked_file_id].filter(Boolean);
    if (!files.length) A.fail('PHOTO_NOT_ARCHIVED', '原图尚未归档');
    const urls = await media.links(files);
    return { original_url: urls[p.original_file_id] || null,
      watermarked_url: p.status === 'ready' ? urls[p.watermarked_file_id] || null : null };
  }
  return { startEvent, reservePhoto, uploadTarget, processPhoto, removePhoto, submitBase, finishDoor, cancelDoor,
    saveIssue, completeTrip, reopenTrip, getWorkflow, photoLinks };
}
module.exports = { makeWorkflow, BASE, MAX_BYTES, LEASE_MS, photoView, eventView };
