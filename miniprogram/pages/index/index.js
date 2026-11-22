// pages/index/index.js —— 首页：填写车牌号 -> 创建运输档案（或继续上次运输）
const config = require('../../config');
const plateUtil = require('../../utils/plate');
const cloud = require('../../utils/cloud');

Page({
  data: {
    plateNumber: '',
    keyboardVisible: false,
    submitting: false,
    lastRecord: null, // 本地缓存的最近一次档案
  },

  onShow() {
    const rec = wx.getStorageSync(config.STORAGE_KEYS.RECORD);
    this.setData({ lastRecord: rec || null });
  },

  // ==== 车牌键盘交互 ====
  onTapPlateInput() {
    this.setData({ keyboardVisible: true });
  },
  onPlateInput(e) {
    this.setData({ plateNumber: e.detail.value });
  },
  onPlateConfirm() {
    this.setData({ keyboardVisible: false });
  },
  onPlateClose() {
    this.setData({ keyboardVisible: false });
  },

  // ==== 开始记录运输：创建新档案 ====
  async onStart() {
    if (this.data.submitting) return;

    const v = plateUtil.validatePlate(this.data.plateNumber);
    if (!v.ok) {
      wx.showToast({ title: v.msg, icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '正在创建档案…', mask: true });
    try {
      const record = await cloud.call('createRecord', { plateNumber: v.value });
      wx.setStorageSync(config.STORAGE_KEYS.RECORD, record);
      this.setData({ lastRecord: record });
      wx.hideLoading();
      wx.showToast({ title: '档案已创建', icon: 'success' });
      setTimeout(() => {
        wx.navigateTo({
          url: '/pages/record/record?recordNo=' + record.record_no,
        });
      }, 400);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '创建失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ==== 继续上次运输（追加事件/照片）====
  onContinue() {
    const rec = this.data.lastRecord;
    if (!rec || !rec.record_no) return;
    wx.navigateTo({
      url: '/pages/record/record?recordNo=' + rec.record_no,
    });
  },

  // ==== 开始新运输（清空本地缓存，防止档案混淆）====
  onNewTransport() {
    wx.showModal({
      title: '开始新运输',
      content: '开始新运输后，将创建一份新的运输档案（不影响已保存的照片）。是否继续？',
      confirmText: '开始新运输',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync(config.STORAGE_KEYS.RECORD);
          this.setData({ lastRecord: null, plateNumber: '' });
        }
      },
    });
  },
});
