const BASE = ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT'];
const LABELS = { WAYBILL: '货运单', CARGO_PHOTO: '货物码放', LOADED_COMPARTMENT: '装好的车厢',
  DOOR_OPEN: '开门照片', DOOR_CLOSE: '关门照片', ISSUE: '问题照片' };
const STATUS = { pending_upload: '待上传', processing: '正在归档，稍后重试',
  upload_failed: '原图未收齐，请重试', watermark_failed: '原图已保留，水印待重试', ready: '已归档' };
function view(state, drafts) {
  const done = state.phase === 'completed';
  const photos = state.photos.filter(p => !p.removed_at).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
    .map(p => ({ ...p, label: LABELS[p.type], statusText: STATUS[p.status] || '待处理',
      retryable: p.status !== 'ready', localDraft: drafts.some(d => d.photo_id === p.id) }));
  const events = state.events.filter(e => e.status !== 'cancelled').sort((a, b) => a.event_no - b.event_no)
    .map(e => ({ ...e, photos: photos.filter(p => p.event_id === e.id),
      empty: !e.pending_count && !Object.values(e.ready_by_type).some(n => n > 0),
      openReady: (e.ready_by_type.DOOR_OPEN || 0) > 0,
      closeReady: (e.ready_by_type.DOOR_CLOSE || 0) > 0,
      canFinish: !e.pending_count && e.ready_by_type.DOOR_OPEN > 0 && e.ready_by_type.DOOR_CLOSE > 0 }));
  const pending = drafts.map(d => ({ ...d, label: LABELS[d.type], statusText: STATUS[d.status] || '待处理' }));
  const base = BASE.map((type, index) => {
    const event = events.find(e => e.kind === 'base' && e.type === type);
    return { type, label: LABELS[type], index: index + 1, event_id: event && event.id,
      ready: state.base_ready[type] || 0, photos: event ? event.photos : [],
      locked: done || !BASE.slice(0, index).every(t => state.base_ready[t] > 0) };
  });
  return { state, done, base, pending, doors: events.filter(e => e.kind === 'door'),
    issues: events.filter(e => e.kind === 'issue'), allBaseReady: BASE.every(t => state.base_ready[t] > 0),
    activeDoor: events.find(e => e.id === state.active_door) || null,
    canComplete: !done && state.phase === 'transporting' && !state.active_door &&
      state.closed_door_count > 0 && !state.pending_count && !drafts.length,
    phaseText: done ? '本趟运输已完成' : state.phase === 'preparing' ? '先拍齐运输前三项' : '运输中 · 每次开关门都拍照',
  };
}
module.exports = { view, BASE, LABELS };
