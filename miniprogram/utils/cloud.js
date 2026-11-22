// utils/cloud.js —— 云函数调用封装：Promise 化 + 统一错误处理

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 参数
 * @returns {Promise<any>} resolve 业务数据
 */
function call(name, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: data || {},
      success: (res) => {
        const r = res.result || {};
        if (r && r.success) {
          resolve(r.data);
        } else {
          reject({
            code: (r && r.code) || 'UNKNOWN',
            message: (r && r.message) || '操作失败，请重试',
          });
        }
      },
      fail: (err) => {
        reject({
          code: 'NETWORK',
          message: '网络异常，请检查网络后重试',
          detail: err,
        });
      },
    });
  });
}

module.exports = { call };
