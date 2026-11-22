// config.js —— 全局配置（提交到仓库的内容，不含任何密钥）
//
// 当前指向负责人确认的专用测试环境；发布前重新核对目标环境。

module.exports = {
  // 专用测试环境，与 cloudbaserc.json 和后台运行时配置保持一致
  CLOUD_ENV_ID: 'cloud1-d3go2mtsga3f8ea74',

  // 固定节点的采集顺序（严格锁定：上一步未完成不可进下一步）
  // 顺序：货运运单 -> 货物照片 -> 装箱完成照片（负责人确认的最终顺序）
  FIXED_STEPS: ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT'],

  // 事件类型定义（与云函数、数据库保持一致）
  EVENT_TYPES: {
    WAYBILL: { code: 'WAYBILL', name: '货运运单', fixed: true, order: 1 },
    CARGO_PHOTO: { code: 'CARGO_PHOTO', name: '货物照片', fixed: true, order: 2 },
    LOADED_COMPARTMENT: { code: 'LOADED_COMPARTMENT', name: '装箱完成照片', fixed: true, order: 3 },
    DOOR_OPEN: { code: 'DOOR_OPEN', name: '开门', fixed: false },
    DOOR_CLOSE: { code: 'DOOR_CLOSE', name: '关门', fixed: false },
    OTHER: { code: 'OTHER', name: '其他照片', fixed: false },
  },

  // 本地缓存键
  STORAGE_KEYS: {
    RECORD: 'tpa_current_record', // 当前档案（含 access_token）
  },
};
