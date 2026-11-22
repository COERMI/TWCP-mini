// 后台业务接口封装（统一带 token）
import { callFunction } from './cloudbase';
import { getToken } from '../utils/auth';

// 管理员登录
export function login(username, password) {
  return callFunction('adminLogin', { username, password });
}
export function prepareTrip(input) {
  return callFunction('transportV1', { ...input, action: 'prepare', token: getToken() });
}
export function getInvitation(record_id) {
  return callFunction('transportV1', { action: 'adminInvite', record_id, token: getToken() });
}
export function revokeInvitation(invite) {
  return callFunction('transportV1', { action: 'revoke', invite, token: getToken() });
}
export async function previewInvitation(record_id) {
  const response = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record_id, token: getToken() }), credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok && !result.message) throw new Error('二维码暂未生成，请重试');
  return result;
}

// 档案列表（分页 + 搜索 + 筛选）
export function listRecords(params = {}) {
  return callFunction('transportV1', { ...params, action: 'adminList', token: getToken() });
}

export function workflowPage(record_id, source, collection, cursor) {
  return callFunction('transportV1', { action: 'adminWorkflow', token: getToken(), record_id, source, collection, cursor });
}
export function photoLinks(record_id, source, photo_id) {
  return callFunction('transportV1', { action: 'adminPhotoLinks', token: getToken(), record_id, source, photo_id });
}
export async function getRecordAdmin(record_id, source = 'v1') {
  for (let attempt = 0; attempt < 3; attempt++) {
    let record, changed = false;
    const result = { events: [], photos: [] };
    for (const collection of ['events', 'photos']) {
      let cursor = null;
      do {
        const response = await workflowPage(record_id, source, collection, cursor);
        if (!response.success) return response;
        const data = response.data;
        if (!record) record = data.record;
        if (source === 'v1' && record.revision !== data.record.revision) { changed = true; break; }
        result[collection].push(...data.items); cursor = data.next_cursor;
      } while (cursor);
      if (changed) break;
    }
    if (changed) continue;
    const last = await workflowPage(record_id, source, 'events', null);
    if (!last.success) return last;
    if (source === 'v1' && last.data.record.revision !== record.revision) continue;
    return { success: true, data: { record, ...result } };
  }
  return { success: false, code: 'CHANGING', message: '司机正在更新照片，请稍后刷新本趟状态' };
}
