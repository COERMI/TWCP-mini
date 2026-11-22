// app.js —— 小程序入口，初始化云开发
const config = require('./config');

App({
  globalData: {
    // 当前进行中的档案（用于采集页与「继续上次运输」）
    currentRecord: null,
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库过低，请升级微信至最新版本以使用云开发能力');
      return;
    }
    wx.cloud.init({
      env: config.CLOUD_ENV_ID,
      traceUser: true,
    });
  },
});
