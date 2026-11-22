export const PHASES = {
  awaiting_plate: '待司机确认', preparing: '运输前拍照', transporting: '运输中', completed: '运输已完成',
  legacy_active: '旧档案 · 进行中', legacy_submitted: '旧档案 · 已提交基础资料',
};
export const PHOTO_STATUS = {
  ready: '已归档', pending_upload: '原图待上传', processing: '水印处理中',
  upload_failed: '原图上传失败', watermark_failed: '原图已保留，水印失败', legacy_unverified: '旧图 · 水印待核验',
};
export const TYPES = { WAYBILL: '货运单', CARGO_PHOTO: '货物码放', LOADED_COMPARTMENT: '装好的车厢',
  DOOR_OPEN: '开门', DOOR_CLOSE: '关门', ISSUE: '问题照片', LEGACY: '旧照片' };
export function groupedEvents(events, photos, includeCorrections = false) {
  const grouped = new Map();
  for (const photo of [...photos].sort((a, b) => (a.created_at || 0) - (b.created_at || 0) || a.id.localeCompare(b.id))) {
    if (photo.removed_at && !includeCorrections) continue;
    if (!grouped.has(photo.event_id)) grouped.set(photo.event_id, []);
    grouped.get(photo.event_id).push(photo);
  }
  return [...events].filter(e => includeCorrections || e.status !== 'cancelled')
    .sort((a, b) => a.event_no - b.event_no || a.id.localeCompare(b.id))
    .map(e => ({ ...e, photos: grouped.get(e.id) || [], active_count: (grouped.get(e.id) || []).filter(p => !p.removed_at).length }));
}
