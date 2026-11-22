const requestId = () => `phone_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
async function call(input) {
  const { result } = await wx.cloud.callFunction({ name: 'transportV1', data: input, config: { timeout: 60000 } });
  if (!result || !result.success) {
    const error = new Error(result && result.message || '连接未完成，请重试');
    error.code = result && result.code || 'NETWORK';
    throw error;
  }
  return result.data;
}
async function mutate(record_id, action, payload = {}) {
  const key = `v1_action_${record_id}_${action}`, signature = JSON.stringify(payload);
  let draft = wx.getStorageSync(key);
  if (!draft || draft.signature !== signature) {
    draft = { signature, request_id: requestId() };
    wx.setStorageSync(key, draft);
  }
  const data = await call({ action, record_id, ...payload, request_id: draft.request_id });
  wx.removeStorageSync(key);
  return data;
}
async function snapshot(record_id) {
  // A changing trip must not be presented as one consistent, complete snapshot.
  for (let attempt = 0; attempt < 3; attempt++) {
    let revision = null, changed = false, state;
    const result = { events: [], photos: [] };
    for (const collection of ['events', 'photos']) {
      let cursor = null;
      do {
        const page = await call({ action: 'getWorkflow', record_id, collection, cursor });
        if (revision === null) { revision = page.revision; state = page; }
        if (page.revision !== revision) { changed = true; break; }
        result[collection].push(...page.items); cursor = page.next_cursor;
      } while (cursor);
      if (changed) break;
    }
    if (!changed) {
      const last = await call({ action: 'getWorkflow', record_id, collection: 'events' });
      if (last.revision === revision) return { ...state, ...result };
    }
  }
  throw new Error('照片状态正在更新，请稍后刷新');
}
module.exports = { call, mutate, snapshot, requestId };
