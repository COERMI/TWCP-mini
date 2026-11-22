const access = require('../../probe-access');
const KEY = 'tpa_stage3_photo';
const call = data => wx.cloud.callFunction({ name: 'imagePipelineV1Probe', data: { ...data, ticket: access.ticket } })
  .then(({ result }) => {
    if (!result || !result.success) throw new Error(result && (result.message || result.code) || '云端未返回结果');
    return result.data;
  });
Page({
  data: { draft: null, preview: null, result: null, busy: false, message: '', error: '', expired: false },
  onLoad() {
    this.setData({ draft: wx.getStorageSync(KEY) || null, expired: Date.now() > access.expiresAt });
  },
  async shoot(e) {
    if (this.data.busy || this.data.expired) return;
    if (this.data.draft) {
      const answer = await wx.showModal({ title: '已有一张待测试照片', content: '请先完成这张的上传或重试；原图不会被新照片替换。', showCancel: false });
      return answer;
    }
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera'], sizeType: ['original'] });
      const file = result.tempFiles[0];
      if (file.size > 20 * 1024 * 1024) throw new Error('这张超过20MB，请另拍一张测试照片');
      this.setData({ preview: { path: file.tempFilePath, captureTime: Date.now(), type: e.currentTarget.dataset.type },
        result: null, error: '', message: '' });
    } catch (error) { if (!String(error.errMsg).includes('cancel')) this.setData({ error: error.message || '相机未能打开' }); }
  },
  cancel() { this.setData({ preview: null }); },
  async usePhoto() {
    if (this.data.busy || !this.data.preview) return;
    this.setData({ busy: true, error: '' });
    const preview = this.data.preview;
    try {
      const saved = await new Promise((resolve, reject) => wx.getFileSystemManager().saveFile({
        tempFilePath: preview.path, success: resolve, fail: reject,
      }));
      const draft = { ...preview, path: saved.savedFilePath, requestId: `phone_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        fileID: null, startedAt: Date.now() };
      this.persist(draft); this.setData({ preview: null });
    } catch (error) { this.setData({ error: '无法把照片保存在手机，请检查空间后重试' }); }
    finally { this.setData({ busy: false }); }
    if (this.data.draft) return this.upload();
  },
  persist(draft) { wx.setStorageSync(KEY, draft); this.setData({ draft }); },
  async upload() {
    if (this.data.busy || !this.data.draft || this.data.expired) return;
    this.setData({ busy: true, error: '', message: '正在准备测试上传…' });
    const draft = this.data.draft;
    try {
      const prepared = await call({ action: 'prepare', requestId: draft.requestId });
      if (!draft.fileID) {
        this.setData({ message: '正在上传原图…' });
        const uploaded = await wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath: draft.path });
        draft.fileID = uploaded.fileID; this.persist(draft);
      }
      this.setData({ message: '原图已上传，正在处理水印…' });
      const result = await call({ action: 'process', requestId: draft.requestId, fileID: draft.fileID,
        captureTime: draft.captureTime, type: draft.type });
      this.setData({ result, message: result.status === 'ready' ? '原图和水印图均已保存，请打开检查清晰度。' : '原图已保留，水印失败；可直接重试，不用重新拍。' });
      if (result.status === 'ready') {
        wx.removeStorageSync(KEY); this.setData({ draft: null });
        wx.getFileSystemManager().removeSavedFile({ filePath: draft.path, fail() {} });
      }
    } catch (error) {
      this.setData({ error: error.message || error.errMsg || '网络中断，请重试；仍使用原照片和拍摄时间', message: '' });
    } finally { this.setData({ busy: false }); }
  },
  async viewImage(e) {
    const result = this.data.result;
    const fileID = e.currentTarget.dataset.kind === 'original' ? result.originalFileID : result.watermarkedFileID;
    if (!fileID) return;
    try {
      const url = e.currentTarget.dataset.kind === 'original' ? result.originalUrl : result.watermarkedUrl;
      if (url) { wx.previewImage({ urls: [url] }); return; }
      const response = await wx.cloud.downloadFile({ fileID });
      wx.previewImage({ urls: [response.tempFilePath] });
    } catch (error) { this.setData({ error: '图片暂时无法下载，请保留请求编号并反馈' }); }
  },
});
