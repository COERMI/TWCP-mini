const KEY = 'transport_v1_create_draft';
export function beijingToday(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
export function newDraft(cryptoApi = crypto) {
  return { request_id: 'prepare_' + cryptoApi.randomUUID(), plate_number: '',
    ship_date: beijingToday(), description: '', batch: '', submitted: false };
}
export function readDraft(storage = sessionStorage) {
  try {
    const value = JSON.parse(storage.getItem(KEY));
    if (value && /^prepare_[a-f0-9-]{36}$/.test(value.request_id) &&
        ['plate_number','ship_date','description','batch'].every(key => typeof value[key] === 'string')) {
      return { ...value, submitted: Boolean(value.submitted) };
    }
  } catch {}
  return null;
}
export function saveDraft(draft, storage = sessionStorage) {
  // Persist the exact request before sending. On a lost response, fields stay
  // locked and the same request can be retried, including after a page reload.
  storage.setItem(KEY, JSON.stringify(draft));
}
export function clearDraft(storage = sessionStorage) { storage.removeItem(KEY); }
export function preparePayload(draft) {
  return { request_id: draft.request_id, plate_number: draft.plate_number.trim().toUpperCase(),
    ship_date: draft.ship_date, description: draft.description.trim(), batch: draft.batch.trim() };
}
export function validateDraft(draft) {
  const input = preparePayload(draft);
  if (!/^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-HJ-NP-Z0-9挂学警港澳]{5,6}$/.test(input.plate_number)) return '请填写完整车牌，例如粤B12345';
  const date = new Date(input.ship_date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.ship_date) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0,10) !== input.ship_date) return '请选择有效发货日期';
  if (!input.description || input.description.length > 120 || input.batch.length > 60) return '请填写运输方向，说明不超过120字，批次不超过60字';
  return '';
}
