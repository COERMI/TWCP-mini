// components/plate-keyboard/index.js —— 自研车牌号键盘组件
// 三态自动切换：省份键盘(第1位) -> 纯字母键盘(第2位) -> 字母数字键盘(第3位起，含特殊车牌尾字)
const plate = require('../../utils/plate');

Component({
  properties: {
    // 当前车牌号字符串
    value: { type: String, value: '' },
    // 是否显示键盘
    visible: { type: Boolean, value: false },
    // 最大长度（标准 7 位，新能源 8 位）
    maxLength: { type: Number, value: 8 },
  },

  data: {
    rows: [],
    keyboardType: 'province',
  },

  lifetimes: {
    attached() {
      this.setData({
        keyboardType: 'province',
        rows: this.buildRows('province'),
      });
    },
  },

  observers: {
    'value, visible': function (value, visible) {
      if (!visible) return;
      const type = plate.keyboardTypeFor(value || '');
      if (type !== this.data.keyboardType) {
        this.setData({ keyboardType: type, rows: this.buildRows(type) });
      }
    },
  },

  methods: {
    // 构造键盘布局，返回 [[{type,label}], ...]
    buildRows(type) {
      const ch = (label) => ({ type: 'char', label });
      const clear = { type: 'clear', label: '清空' };
      const del = { type: 'delete', label: '⌫' };

      if (type === 'province') {
        const rows = [];
        const p = plate.PROVINCES;
        for (let i = 0; i < p.length; i += 7) {
          rows.push(p.slice(i, i + 7).map(ch));
        }
        // 最后一行补功能键
        rows[rows.length - 1] = rows[rows.length - 1].concat([clear, del]);
        return rows;
      }

      if (type === 'letter') {
        const letters = plate.LETTERS; // 24 个，不含 I/O
        const rows = [];
        for (let i = 0; i < letters.length; i += 8) {
          rows.push(letters.slice(i, i + 8).map(ch));
        }
        rows[rows.length - 1] = rows[rows.length - 1].concat([clear, del]);
        return rows;
      }

      // alnum：数字 + 字母 + 特殊车牌尾字
      const rows = [
        plate.DIGITS.map(ch),
        plate.LETTERS.slice(0, 8).map(ch),
        plate.LETTERS.slice(8, 16).map(ch),
        plate.LETTERS.slice(16).map(ch),
        plate.SPECIAL_CHARS.map(ch).concat([clear, del]),
      ];
      return rows;
    },

    onTapKey(e) {
      const type = e.currentTarget.dataset.key;
      const label = e.currentTarget.dataset.label || '';
      let next = this.data.value || '';

      if (type === 'delete') {
        next = next.slice(0, -1);
      } else if (type === 'clear') {
        next = '';
      } else {
        if (next.length >= this.data.maxLength) return;
        next = next + label;
      }

      // 触发 input 事件同步给父组件
      this.triggerEvent('input', { value: next });

      // 键盘类型可能切换（例如输入第 1 位后从省份键盘切到字母键盘）
      const newType = plate.keyboardTypeFor(next);
      if (newType !== this.data.keyboardType) {
        this.setData({ keyboardType: newType, rows: this.buildRows(newType) });
      }
    },

    onConfirm() {
      this.triggerEvent('confirm', { value: this.data.value });
    },

    onClose() {
      this.triggerEvent('close');
    },
  },
});
