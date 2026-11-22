// pages/record/record.js —— 采集页：严格顺序引导 + 拍照 + 定位 + 上传 + 提交/追加
const config = require('../../config');
const cloud = require('../../utils/cloud');
const geo = require('../../utils/geo');

const STEP_DESC = {
  WAYBILL: '请拍清楚运单上的单号、收货信息',
  CARGO_PHOTO: '请拍清楚整批货物的完整外观',
  LOADED_COMPARTMENT: '请拍清楚货物装车后的车厢情况',
};

const EMPTY_PREVIEW = { visible: false, tempPath: '', eventType: '', eventName: '' };

Page({
  data: {
    record: null,
    recordNo: '',
    steps: [],
    doorOpenCount: 0,
    doorCloseCount: 0,
    totalPhotos: 0,
    uploading: false,
    submitting: false,
    preview: EMPTY_PREVIEW,
    previewRemark: '',
  },

  onLoad(options) {
    this.captureTime = null;
    this.setData({ recordNo: options.recordNo || '' });
    this.loadRecord();
  },

  onPullDownRefresh() {
    this.loadRecord().finally(() => wx.stopPullDownRefresh());
  },

  // ==== 加载档案数据 ====
  loadRecord() {
    return cloud
      .call('getRecord', {
        record_no: this.data.recordNo,
        access_token: this.getToken(),
      })
      .then((data) => {
        this.applyRecord(data);
        // 更新本地缓存中的档案状态
        this.syncCache(data.record);
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  applyRecord(data) {
    const record = data.record;
    const events = data.events || [];

    const steps = [];
    config.FIXED_STEPS.forEach((type, idx) => {
      const def = config.EVENT_TYPES[type];
      const ev = events.find((e) => e.event_type === type);
      const count = ev ? ev.photo_count || 0 : 0;
      const done = count > 0;
      const unlocked = idx === 0 || steps[idx - 1].done;
      steps.push({
        type,
        name: def.name,
        desc: STEP_DESC[type] || '',
        count,
        done,
        unlocked,
      });
    });

    const doorOpenCount = events.filter((e) => e.event_type === 'DOOR_OPEN').length;
    const doorCloseCount = events.filter((e) => e.event_type === 'DOOR_CLOSE').length;
    const totalPhotos = events.reduce((s, e) => s + (e.photo_count || 0), 0);

    this.setData({ record, steps, doorOpenCount, doorCloseCount, totalPhotos });
  },

  getToken() {
    const cached = wx.getStorageSync(config.STORAGE_KEYS.RECORD);
    return cached && cached.record_no === this.data.recordNo ? cached.access_token : '';
  },

  syncCache(record) {
    if (!record) return;
    const cached = wx.getStorageSync(config.STORAGE_KEYS.RECORD);
    wx.setStorageSync(config.STORAGE_KEYS.RECORD, Object.assign({}, cached, record));
  },

  // ==== 拍摄入口 ====
  onShootFixed(e) {
    const type = e.currentTarget.dataset.type;
    const step = this.data.steps.find((s) => s.type === type);
    if (!step || !step.unlocked) {
      wx.showToast({ title: '请先完成上一步拍摄', icon: 'none' });
      return;
    }
    this.shootForEvent(type, step.name);
  },

  onShootDoorOpen() {
    this.shootForEvent('DOOR_OPEN', '开门');
  },

  onShootDoorClose() {
    this.shootForEvent('DOOR_CLOSE', '关门');
  },

  // 调起相机拍照，成功后进入预览
  shootForEvent(eventType, eventName) {
    if (this.data.uploading) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      camera: 'back',
      success: (res) => {
        const tempPath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (!tempPath) return;
        this.captureTime = Date.now(); // 记录设备拍摄时刻（近似值）
        this.setData({
          previewRemark: '',
          preview: { visible: true, tempPath, eventType, eventName },
        });
      },
      fail: (err) => {
        // 用户主动取消不提示
        const msg = err && err.errMsg ? err.errMsg : '';
        if (msg.indexOf('cancel') < 0) {
          wx.showToast({ title: '无法调起相机', icon: 'none' });
        }
      },
    });
  },

  // ==== 预览层操作 ====
  onRetake() {
    const { eventType, eventName } = this.data.preview;
    this.setData({ preview: EMPTY_PREVIEW, previewRemark: '' });
    this.shootForEvent(eventType, eventName);
  },

  onClosePreview() {
    this.setData({ preview: EMPTY_PREVIEW, previewRemark: '' });
  },

  onRemarkInput(e) {
    this.setData({ previewRemark: e.detail.value });
  },

  // 确认上传
  onConfirmUpload() {
    this.uploadCurrent();
  },

  // ==== 上传主流程 ====
  async uploadCurrent() {
    const { tempPath, eventType } = this.data.preview;
    if (!tempPath || this.data.uploading) return;

    this.setData({ uploading: true });
    wx.showLoading({ title: '正在上传…', mask: true });

    try {
      // 1. 定位（失败不阻断上传，标记「定位未获取」）
      const location = await this.tryLocate();

      // 2. 上传原图到云存储
      const fileID = await this.uploadOriginal(tempPath);

      // 3. 调用 uploadPhoto 云函数（生成水印 + 入库 + 关联事件）
      await cloud.call('uploadPhoto', {
        record_no: this.data.record.record_no,
        access_token: this.getToken(),
        event_type: eventType,
        file_id: fileID,
        device_capture_time: this.captureTime,
        latitude: location ? location.latitude : null,
        longitude: location ? location.longitude : null,
        accuracy: location ? location.accuracy : null,
        remark: this.data.previewRemark || '',
      });

      wx.hideLoading();
      wx.showToast({ title: '上传成功', icon: 'success' });
      this.setData({ preview: EMPTY_PREVIEW, previewRemark: '' });
      await this.loadRecord();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '上传失败',
        content: (err.message || '网络异常') + '。是否重试？',
        confirmText: '重试',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) this.uploadCurrent();
        },
      });
    } finally {
      this.setData({ uploading: false });
    }
  },

  // 定位：失败返回 null（允许无定位上传，不伪造地址）
  async tryLocate() {
    try {
      return await geo.getLocation();
    } catch (e) {
      if (e.code === 'AUTH_DENY') {
        // 引导重新授权
        const granted = await geo.openLocationSetting();
        if (granted) {
          try {
            return await geo.getLocation();
          } catch (e2) {
            /* 忽略 */
          }
        }
      }
      wx.showToast({ title: '定位未获取', icon: 'none' });
      return null;
    }
  },

  // 上传原图到云存储，返回 fileID
  uploadOriginal(tempPath) {
    const recordNo = this.data.record.record_no;
    const ext = this.getExt(tempPath);
    const cloudPath =
      'transport-records/' + recordNo + '/' + Date.now() + '-' +
      Math.floor(Math.random() * 100000) + '.' + ext;
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath,
        success: (res) => resolve(res.fileID),
        fail: () => reject({ message: '图片上传失败，请重试' }),
      });
    });
  },

  getExt(path) {
    const m = /\.(\w+)$/.exec(path);
    return m ? m[1] : 'jpg';
  },

  // ==== 完成本次运输 ====
  onSubmit() {
    if (this.data.submitting) return;
    wx.showModal({
      title: '完成本次运输',
      content: '提交后仍可继续追加照片。确认完成本次运输？',
      confirmText: '完成',
      cancelText: '再等等',
      success: (res) => {
        if (res.confirm) this.doSubmit();
      },
    });
  },

  async doSubmit() {
    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交…', mask: true });
    try {
      await cloud.call('submitRecord', {
        record_no: this.data.recordNo,
        access_token: this.getToken(),
      });
      wx.hideLoading();
      wx.showToast({ title: '已提交', icon: 'success' });
      await this.loadRecord();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
