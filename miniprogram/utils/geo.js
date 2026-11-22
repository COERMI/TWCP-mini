// utils/geo.js —— 定位封装：Promise 化 + 授权处理

/**
 * 获取定位（gcj02 国测局坐标，国内地图通用）
 * @returns {Promise<{latitude:number, longitude:number, accuracy:number|null}>}
 */
function getLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: (res) => {
        resolve({
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: typeof res.accuracy === 'number' ? res.accuracy : null,
        });
      },
      fail: (err) => {
        const msg = err && err.errMsg ? err.errMsg : '';
        if (msg.indexOf('auth deny') >= 0 || msg.indexOf('auth denied') >= 0) {
          reject({ code: 'AUTH_DENY', message: '未授权定位，请授权后重试' });
        } else {
          reject({ code: 'LOCATION_FAIL', message: '定位失败，请重试' });
        }
      },
    });
  });
}

/**
 * 打开授权设置页（用户曾拒绝定位后，引导其重新授权）
 * @returns {Promise<boolean>} 是否已授权定位
 */
function openLocationSetting() {
  return new Promise((resolve) => {
    wx.openSetting({
      success: (res) => {
        const ok = !!(res.authSetting && res.authSetting['scope.userLocation']);
        resolve(ok);
      },
      fail: () => resolve(false),
    });
  });
}

module.exports = { getLocation, openLocationSetting };
