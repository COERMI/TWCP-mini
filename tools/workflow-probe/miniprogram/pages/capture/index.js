// Guides are preview-only and never drawn into the original file.
Page({
  data: { ready: false, busy: false, error: '', label: '' },
  onLoad(options) { this.setData({ label: options.label || '现场照片' }); },
  init() { this.setData({ ready: true, error: '' }); },
  cameraError() { this.setData({ ready: false, error: '相机未开启，请检查微信相机权限后重新进入。' }); },
  async take() {
    if (!this.data.ready || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const photo = await new Promise((resolve, reject) => wx.createCameraContext().takePhoto({
        quality: 'original', success: resolve, fail: reject,
      }));
      const info = await new Promise((resolve, reject) => wx.getFileInfo({
        filePath: photo.tempImagePath, success: resolve, fail: reject,
      }));
      this.sent = true;
      this.getOpenerEventChannel().emit('captured', {
        tempFilePath: photo.tempImagePath, size: info.size, captureTime: Date.now(),
      });
      wx.navigateBack();
    } catch (error) {
      this.setData({ busy: false, error: '拍摄未完成，请重试。' });
    }
  },
  onUnload() { if (!this.sent) this.getOpenerEventChannel().emit('cancelled'); },
});
