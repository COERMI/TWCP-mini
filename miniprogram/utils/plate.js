// utils/plate.js —— 车牌号工具：省份简称、格式校验、键盘数据

// 31 个省级行政区简称
const PROVINCES = [
  '京', '津', '冀', '晋', '蒙', '辽', '吉', '黑', '沪', '苏',
  '浙', '皖', '闽', '赣', '鲁', '豫', '鄂', '湘', '粤', '桂',
  '琼', '渝', '川', '贵', '云', '藏', '陕', '甘', '青', '宁',
  '新',
];

// 车牌第 2 位及以后可用字母（车牌规范不使用 I、O，避免与 1、0 混淆）
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''); // 24 个
const DIGITS = '0123456789'.split('');

// 特殊车牌尾字（挂车、教练车、警车、使领馆、港澳入出境等），放宽兼容，不误拒
const SPECIAL_CHARS = ['挂', '学', '警', '使', '领', '港', '澳'];

// 键盘功能键
const KEY_DELETE = { type: 'delete', label: '⌫' };
const KEY_CLEAR = { type: 'clear', label: '清空' };

/**
 * 校验车牌号（宽松规则，兼容新能源 8 位、挂车/教练车等特殊牌）
 * @param {string} plate 原始输入
 * @returns {{ok: boolean, value: string, msg: string}}
 */
function validatePlate(plate) {
  if (!plate || !plate.trim()) {
    return { ok: false, value: '', msg: '请输入车牌号' };
  }
  const p = plate.trim().toUpperCase();

  if (p.length < 7 || p.length > 8) {
    return { ok: false, value: p, msg: '车牌号应为 7 位或 8 位（新能源为 8 位）' };
  }
  if (!isProvince(p[0])) {
    return { ok: false, value: p, msg: '首位应为省份简称，如 川、粤、京' };
  }
  const second = p[1];
  if (!/^[A-Z]$/.test(second) || second === 'I' || second === 'O') {
    return { ok: false, value: p, msg: '第 2 位应为字母（不含 I、O）' };
  }

  const rest = p.slice(2);
  for (const ch of rest) {
    if (ch === 'I' || ch === 'O') {
      return { ok: false, value: p, msg: '车牌号不含字母 I、O' };
    }
    const isAlnum = /[A-Z0-9]/.test(ch);
    const isSpecial = SPECIAL_CHARS.indexOf(ch) >= 0;
    if (!isAlnum && !isSpecial) {
      return { ok: false, value: p, msg: '车牌号含无效字符：' + ch };
    }
  }
  return { ok: true, value: p, msg: '' };
}

function isProvince(ch) {
  return PROVINCES.indexOf(ch) >= 0;
}

/**
 * 根据当前车牌内容决定键盘类型
 * @returns {'province'|'letter'|'alnum'}
 *   province：第 1 位用省份简称键盘
 *   letter：第 2 位用纯字母键盘（车牌第 2 位必为字母）
 *   alnum：第 3 位起用字母数字键盘（含特殊车牌尾字）
 */
function keyboardTypeFor(plate) {
  const p = (plate || '').trim();
  if (p.length === 0) return 'province';
  if (p.length === 1) return 'letter';
  return 'alnum';
}

module.exports = {
  PROVINCES,
  LETTERS,
  DIGITS,
  SPECIAL_CHARS,
  KEY_DELETE,
  KEY_CLEAR,
  validatePlate,
  isProvince,
  keyboardTypeFor,
};
