'use strict';
const A = require('./auth');
const { eventView, photoView } = require('./workflow');
const LEGACY = { records: 'transport_records', events: 'transport_events', photos: 'photo_records' };
const millis = value => {
  if (value === null || value === undefined) return null;
  const n = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(n) ? n : null;
};
function dateBoundary(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    A.fail('INVALID_DATE', '查询日期不正确');
  }
  return Date.parse(value + 'T00:00:00+08:00');
}
function sourceOf(input) {
  const source = input.source || 'v1';
  if (!['v1', 'legacy'].includes(source)) A.fail('INVALID_SOURCE', '请选择新版运输或旧档案');
  return source;
}
function recordView(r, source) {
  return {
    id: r._id, source, record_no: r.record_no, plate_number: r.plate_number,
    ship_date: r.ship_date || '', description: r.description || '', batch: r.batch || '',
    phase: source === 'legacy' ? (r.status === 'submitted' ? 'legacy_submitted' : 'legacy_active') : r.phase,
    created_at: millis(r.created_at), updated_at: millis(r.updated_at),
    confirmed_at: millis(r.confirmed_at), departed_at: millis(r.departed_at || r.submitted_at),
    completed_at: millis(r.completed_at), revision: r.revision || 0,
    photo_count: r.photo_count || 0, event_count: r.event_count || 0,
    pending_count: r.pending_count || 0, base_ready: r.base_ready || {},
    door_count: r.door_count || 0, closed_door_count: r.closed_door_count || 0,
    invite_revoked_at: millis(r.invite_revoked_at),
    legacy_warning: source === 'legacy' ? '旧档案按原分组展示，水印质量尚未核验。' : '',
  };
}
function legacyEvent(e) {
  return { id: e._id, kind: ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT'].includes(e.event_type) ? 'base' : 'legacy',
    type: e.event_type, event_no: e.event_no || 0, sequence: e.sequence || 0,
    name: e.event_name || e.event_type || '旧事件', status: 'legacy', note: e.remark || '',
    ready_by_type: {}, pending_count: 0, created_at: millis(e.created_at), closed_at: null };
}
function legacyPhoto(p) {
  return { id: p._id, event_id: p.event_id, type: p.event_type || 'LEGACY',
    status: p.upload_status === 'failed' ? 'upload_failed' : 'legacy_unverified',
    removed_at: millis(p.removed_at), capture_time: millis(p.device_capture_time),
    received_at: millis(p.server_received_at), created_at: millis(p.created_at), ready_at: null,
    original_bytes: p.original_bytes || null, output_bytes: null, version: 'legacy-unverified',
    has_original: Boolean(p.original_url), has_watermark: Boolean(p.watermarked_url),
    location_text: typeof p.location_text === 'string' ? p.location_text : '',
    removal_reason: p.removal_reason || '' };
}
function makeAdmin({ store, config, clock, collections: C, media }) {
  function authorize(input) { return A.admin(input.token, config, clock()); }
  async function record(input) {
    const source = sourceOf(input), id = input.record_id;
    if (typeof id !== 'string' || !(source === 'v1' ? /^trip_[a-f0-9]{40}$/ : /^[A-Za-z0-9_-]{1,128}$/).test(id)) {
      A.fail('INVALID_RECORD', '缺少有效档案编号');
    }
    const r = await store.get(source === 'v1' ? C.records : LEGACY.records, id);
    if (!r) A.fail('NOT_FOUND', '没有找到这趟运输');
    return { r, source, tables: source === 'v1' ? C : LEGACY };
  }
  async function adminList(input) {
    authorize(input);
    const source = sourceOf(input), keyword = A.text(input.keyword, 81), phase = input.phase || '';
    const phases = source === 'v1' ? ['awaiting_plate', 'preparing', 'transporting', 'completed'] : ['legacy_active', 'legacy_submitted'];
    if (keyword.length > 80 || (phase && !phases.includes(phase))) A.fail('INVALID_FILTER', '查询条件不正确');
    const from = dateBoundary(input.date_from), lastDay = dateBoundary(input.date_to);
    const to = lastDay === null ? null : lastDay + 86400000;
    if (from !== null && to !== null && from >= to) A.fail('INVALID_DATE', '结束日期不能早于开始日期');
    const page = input.page === undefined ? 1 : input.page, pageSize = input.pageSize === undefined ? 20 : input.pageSize;
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000 ||
        !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) A.fail('INVALID_PAGE', '分页参数不正确');
    const result = await store.searchRecords(source === 'v1' ? C.records : LEGACY.records,
      { source, keyword, phase, from, to, page, pageSize });
    return { source, list: result.list.map(r => recordView(r, source)), total: result.total, page, pageSize };
  }
  async function adminWorkflow(input) {
    authorize(input);
    const { r, source, tables } = await record(input);
    const collection = input.collection || 'events';
    if (!['events', 'photos'].includes(collection)) A.fail('INVALID_COLLECTION', '查询类型不正确');
    const cursor = input.cursor || '';
    if (typeof cursor !== 'string' || cursor.length > 128 || (cursor && !/^[A-Za-z0-9_-]+$/.test(cursor))) {
      A.fail('INVALID_CURSOR', '分页位置不正确');
    }
    const rows = await store.list(tables[collection], { record_id: r._id }, cursor, 51), page = rows.slice(0, 50);
    const map = source === 'legacy' ? (collection === 'events' ? legacyEvent : legacyPhoto) :
      collection === 'events' ? eventView : p => ({ ...photoView(p), removal_reason: p.removal_reason || '',
        has_original: Boolean(p.original_file_id), has_watermark: p.status === 'ready' && Boolean(p.watermarked_file_id) });
    return { record: recordView(r, source), collection, items: page.map(map),
      next_cursor: rows.length > 50 ? page[49]._id : null };
  }
  function permittedFile(id, r, source, photoId) {
    if (typeof id !== 'string') return false;
    const prefix = `cloud://${config.environment}.`;
    if (!id.startsWith(prefix)) return false;
    const slash = id.indexOf('/', prefix.length), key = id.slice(slash + 1);
    if (slash < prefix.length || !/^[A-Za-z0-9-]+$/.test(id.slice(prefix.length, slash))) return false;
    return source === 'v1' ? key.startsWith(`transport-v1/archive/${r._id}/${photoId}/`) : key.startsWith('transport-records/');
  }
  async function adminPhotoLinks(input) {
    authorize(input);
    const { r, source, tables } = await record(input), id = input.photo_id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) A.fail('INVALID_PHOTO', '照片编号不正确');
    const p = await store.get(tables.photos, id);
    if (!p || p.record_id !== r._id) A.fail('INVALID_PHOTO', '照片不属于这趟运输');
    if (p.removed_at) A.fail('PHOTO_REMOVED', '照片已移除，纠正记录仍保留');
    const original = source === 'v1' ? p.original_file_id : p.original_url;
    const watermarked = source === 'v1' ? (p.status === 'ready' ? p.watermarked_file_id : null) : p.watermarked_url;
    const ids = [original, watermarked].filter(Boolean);
    if (!ids.length) A.fail('PHOTO_NOT_ARCHIVED', '照片尚未归档');
    if (ids.some(file => !permittedFile(file, r, source, id))) A.fail('INVALID_FILE', '文件归属需管理员核对，暂不生成访问链接');
    const urls = await media.links([...new Set(ids)]);
    return { photo_id: id, original_url: urls[original] || null, watermarked_url: urls[watermarked] || null,
      legacy_unverified: source === 'legacy', signed_at: clock() };
  }
  return { adminList, adminWorkflow, adminPhotoLinks };
}
module.exports = { makeAdmin, recordView, legacyEvent, legacyPhoto, dateBoundary, millis };
