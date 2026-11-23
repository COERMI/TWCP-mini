// Durable outbox: save original + request metadata before any network request.
// Clearing local files is allowed only after server READY or acknowledged removal.
function createQueue({ platform, call, requestId, recordId, onProgress = () => {}, clock = Date.now }) {
  const key = `v1_photos_${recordId}`;
  let running = false;
  const list = () => JSON.parse(JSON.stringify(platform.getStorageSync(key) || []));
  const put = draft => {
    const drafts = list(), index = drafts.findIndex(d => d.id === draft.id);
    if (index < 0) drafts.push(draft); else drafts[index] = draft;
    platform.setStorageSync(key, drafts);
  };
  function drop(draft) {
    platform.setStorageSync(key, list().filter(d => d.id !== draft.id));
    platform.getFileSystemManager().removeSavedFile({ filePath: draft.path, fail() {} });
  }
  async function add(tempFile, event, type, captureTime) {
    if (tempFile.size > 20 * 1024 * 1024) throw new Error('照片超过20MB，请重新拍摄');
    if (list().length >= 20) throw new Error('手机已有20张待处理照片，请先上传或处理后再拍');
    const saved = await new Promise((resolve, reject) => platform.getFileSystemManager().saveFile({
      tempFilePath: tempFile.tempFilePath, success: resolve, fail: reject,
    }));
    const draft = {
      id: requestId(), record_id: recordId, event_id: event.id, event_name: event.name,
      type, capture_time: captureTime, path: saved.savedFilePath,
      photo_id: null, cloud_path: null, file_id: null, error: '', status: 'pending_upload', reservation_attempted: false,
    };
    // If metadata storage fails, preserve the file and report failure, never upload an untracked image.
    put(draft);
    return draft;
  }
  async function reserve(draft) {
    if (draft.photo_id) return;
    draft.reservation_attempted = true; put(draft);
    const data = await call({ action: 'reservePhoto', record_id: recordId, event_id: draft.event_id,
      type: draft.type, capture_time: draft.capture_time, request_id: draft.id });
    draft.photo_id = data.photo.id; draft.cloud_path = data.cloud_path; put(draft);
  }
  async function send(id) {
    if (running) return;
    const draft = list().find(d => d.id === id);
    if (!draft) return;
    running = true;
    const started = clock();
    draft.timings = {};
    try {
      onProgress({ stage: '正在准备上传', percent: 0 });
      await reserve(draft);
      draft.timings.reserve_ms = clock() - started;
      if (!draft.file_id) {
        const grantStart = clock();
        const grant = await call({ action: 'uploadTarget', record_id: recordId, photo_id: draft.photo_id });
        draft.timings.grant_ms = clock() - grantStart;
        if (!grant.archived) {
          const uploadStart = clock();
          onProgress({ stage: '正在上传照片', percent: 0 });
          // wx.uploadFile returns an UploadTask, not a Promise. Wait for callback.
          const uploaded = await new Promise((resolve, reject) => {
            const task = platform.uploadFile({
              url: grant.target.url, filePath: draft.path, name: 'file',
              formData: grant.target.form_data, success: resolve, fail: reject,
            });
            if (task && task.onProgressUpdate) task.onProgressUpdate(info =>
              onProgress({ stage: '正在上传照片', percent: Math.max(0, Math.min(100, Number(info.progress) || 0)) }));
          });
          draft.timings.upload_ms = clock() - uploadStart;
          if (!Number.isFinite(uploaded.statusCode) || uploaded.statusCode < 200 || uploaded.statusCode >= 300) {
            throw new Error('上传授权可能已过期，请重试');
          }
          draft.file_id = grant.target.file_id; put(draft);
        }
      }
      onProgress({ stage: '正在生成水印并归档', percent: null });
      const processStart = clock();
      const data = await call({ action: 'processPhoto', record_id: recordId, photo_id: draft.photo_id, file_id: draft.file_id });
      draft.timings.process_ms = clock() - processStart;
      draft.timings.total_ms = clock() - started;
      // Local timing only: never store upload policies, URLs or administrator credentials.
      platform.setStorageSync(`v1_last_photo_timing_${recordId}`, { ...draft.timings, type: draft.type });
      draft.status = data.photo.status; draft.error = '';
      onProgress({ stage: data.photo.status === 'ready' ? '照片已保存' : '照片仍待处理', percent: null });
      if (data.photo.status === 'ready') drop(draft);
      else { put(draft); }
      return data.photo;
    } catch (error) {
      draft.error = String(error.errMsg || '').includes('domain list') ?
        '微信上传域名尚未配置，请联系负责人。照片保留在本机。' :
        error.message || '网络中断，照片仍保存在本机，请重试';
      put(draft); throw new Error(draft.error);
    } finally { running = false; }
  }
  async function discard(id, reason) {
    if (running) throw new Error('照片正在处理，请稍后再试');
    const draft = list().find(d => d.id === id);
    if (!draft) return;
    if (draft.reservation_attempted) {
      // Recover a lost reservation response before cancelling the server record.
      await reserve(draft);
      draft.remove_request ||= requestId(); draft.remove_reason ||= reason; put(draft);
      await call({ action: 'removePhoto', record_id: recordId, photo_id: draft.photo_id,
        request_id: draft.remove_request, reason: draft.remove_reason });
    }
    drop(draft);
  }
  return { list, add, send, discard };
}
module.exports = { createQueue };
