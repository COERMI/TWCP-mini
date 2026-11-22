// test/watermark.test.js —— 水印纯函数回归测试（require 真实模块，非逻辑副本）
//
// 目的：test/logic.test.js 第 5 节复制了一份水印逻辑在测，抓不到真实模块的缺陷
//       （2026-11-21 的两处 null 兜底 bug 就是这样漏掉的）。本文件直接 require
//       生产代码 miniprogram/utils/watermark.js，只测不依赖 wx 的纯函数部分。
// 运行：node test/watermark.test.js   （通过则退出码 0）
const assert = require('assert');
const watermark = require('../miniprogram/utils/watermark.js');

let passCount = 0;
let failCount = 0;

/**
 * 断言相等并计数
 * @param {*} actual 实际值
 * @param {*} expected 期望值
 * @param {string} label 用例说明
 * @returns {void}
 */
function eq(actual, expected, label) {
  try {
    assert.strictEqual(actual, expected);
    passCount += 1;
    console.log('  ✓ ' + label);
  } catch (e) {
    failCount += 1;
    console.log('  ✗ ' + label);
    console.log('      期望: ' + JSON.stringify(expected));
    console.log('      实际: ' + JSON.stringify(actual));
  }
}

/**
 * 断言为真并计数
 * @param {*} value 实际值
 * @param {string} label 用例说明
 * @returns {void}
 */
function ok(value, label) {
  try {
    assert.ok(value);
    passCount += 1;
    console.log('  ✓ ' + label);
  } catch (e) {
    failCount += 1;
    console.log('  ✗ ' + label + '（值为 ' + JSON.stringify(value) + '）');
  }
}

/**
 * 从水印行中取出指定前缀的行
 * @param {string[]} lines 水印行
 * @param {string} prefix 前缀，如「地点：」
 * @returns {string} 命中的行，未命中返回空串
 */
function pick(lines, prefix) {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].indexOf(prefix) === 0) return lines[i];
  }
  return '';
}

// 固定时间戳，避免测试依赖运行时刻
const T_FULL = Date.parse('2026-11-21T10:24:36+08:00'); // 北京时间 2026-11-21 10:24:36（周六）
const T_UTC = Date.parse('2026-11-20T16:30:00Z'); // UTC 16:30 -> 北京时间次日 00:30

// ===== 1. 行序与完整文案（车牌/时间/星期/地点/天气/档案编号/事件）=====
console.log('===== 1. buildLines 行序与完整文案 =====');
const full = watermark.buildLines({
  plateNumber: '沪A12345',
  captureTime: T_FULL,
  locationText: '上海市浦东新区世纪大道100号',
  latitude: 31.230416,
  longitude: 121.473701,
  weather: '晴',
  temperature: 12,
  recordNo: 'TR2026110001',
  eventName: '第3次开门',
});
ok(Array.isArray(full), '返回数组');
eq(full.length, 7, '完整数据输出 7 行');
eq(full[0], '车牌：沪A12345', '第1行 车牌');
eq(full[1], '时间：2026-11-21 10:24:36', '第2行 时间（北京时间 +8h）');
eq(full[2], '星期：星期六', '第3行 星期');
eq(full[3], '地点：上海市浦东新区世纪大道100号', '第4行 地点（逆地理地址优先）');
eq(full[4], '天气：晴 12℃', '第5行 天气（含温度）');
eq(full[5], '档案编号：TR2026110001', '第6行 档案编号');
eq(full[6], '事件：第3次开门', '第7行 事件');

// ===== 2. 无车牌时少一行，其余顺序不变 =====
console.log('===== 2. 无车牌 / 空白车牌 =====');
const noPlate = watermark.buildLines({
  plateNumber: '',
  captureTime: T_FULL,
  locationText: '上海市',
  weather: '多云',
  temperature: 8,
  recordNo: 'TR2026110002',
  eventName: '货运运单',
});
eq(noPlate.length, 6, '无车牌输出 6 行');
eq(noPlate[0], '时间：2026-11-21 10:24:36', '无车牌时首行为时间');
eq(noPlate[5], '事件：货运运单', '末行仍为事件');

const blankPlate = watermark.buildLines({
  plateNumber: '   ',
  captureTime: T_FULL,
  recordNo: 'TR2026110003',
  eventName: '其他照片',
});
eq(blankPlate.length, 6, '空白字符车牌视为无车牌');

// ===== 3. 地点兜底（回归 2026-11-21 缺陷 A：Number(null) === 0 假坐标）=====
console.log('===== 3. 地点兜底（缺陷 A 回归）=====');
const noCoord = watermark.buildLines({
  plateNumber: '沪A12345',
  captureTime: T_FULL,
  locationText: '',
  latitude: null,
  longitude: null,
  weather: null,
  temperature: null,
  recordNo: 'TR2026110001',
  eventName: '第1次开门',
});
eq(pick(noCoord, '地点'), '地点：定位未获取', 'latitude/longitude 为 null -> 定位未获取（不得为 0.000000,0.000000）');

const undefCoord = watermark.buildLines({
  captureTime: T_FULL,
  latitude: undefined,
  longitude: undefined,
  recordNo: 'X',
  eventName: 'Y',
});
eq(pick(undefCoord, '地点'), '地点：定位未获取', 'latitude/longitude 为 undefined -> 定位未获取');

const emptyStrCoord = watermark.buildLines({
  captureTime: T_FULL,
  latitude: '',
  longitude: '',
  recordNo: 'X',
  eventName: 'Y',
});
eq(pick(emptyStrCoord, '地点'), '地点：定位未获取', 'latitude/longitude 为空串 -> 定位未获取');

const zeroCoord = watermark.buildLines({
  captureTime: T_FULL,
  latitude: 0,
  longitude: 0,
  recordNo: 'X',
  eventName: 'Y',
});
eq(pick(zeroCoord, '地点'), '地点：0.000000,0.000000', '（0,0）是合法坐标（赤道/本初子午线），不得误杀');

const realCoord = watermark.buildLines({
  captureTime: T_FULL,
  latitude: 31.230416,
  longitude: 121.473701,
  recordNo: 'X',
  eventName: 'Y',
});
eq(pick(realCoord, '地点'), '地点：31.230416,121.473701', '无逆地理地址时降级为「纬度,经度」6 位小数');

const addrWins = watermark.buildLines({
  captureTime: T_FULL,
  locationText: '上海市浦东新区',
  latitude: 31.230416,
  longitude: 121.473701,
  recordNo: 'X',
  eventName: 'Y',
});
eq(pick(addrWins, '地点'), '地点：上海市浦东新区', '有逆地理地址时优先用地址（不输出坐标）');

// ===== 4. 天气兜底（回归 2026-11-21 缺陷 B：Number(null) === 0 显示 0℃）=====
console.log('===== 4. 天气兜底（缺陷 B 回归）=====');
eq(
  pick(watermark.buildLines({ captureTime: T_FULL, weather: '晴', temperature: null, recordNo: 'X', eventName: 'Y' }), '天气'),
  '天气：晴',
  'weather=晴 + temperature=null -> 天气：晴（不得为 晴 0℃）'
);
eq(
  pick(watermark.buildLines({ captureTime: T_FULL, weather: '晴', temperature: 0, recordNo: 'X', eventName: 'Y' }), '天气'),
  '天气：晴 0℃',
  'weather=晴 + temperature=0（真实 0 度）-> 天气：晴 0℃'
);
eq(
  pick(watermark.buildLines({ captureTime: T_FULL, weather: null, temperature: 18, recordNo: 'X', eventName: 'Y' }), '天气'),
  '天气：暂不可用',
  'weather=null -> 天气：暂不可用（不孤立输出温度）'
);
eq(
  pick(watermark.buildLines({ captureTime: T_FULL, weather: '', temperature: null, recordNo: 'X', eventName: 'Y' }), '天气'),
  '天气：暂不可用',
  'weather=空串 -> 天气：暂不可用'
);
eq(
  pick(watermark.buildLines({ captureTime: T_FULL, weather: '小雨', recordNo: 'X', eventName: 'Y' }), '天气'),
  '天气：小雨',
  'weather=小雨且未传 temperature -> 天气：小雨'
);

// ===== 5. 时区口径（北京时间，跨日场景）=====
console.log('===== 5. 时区口径 =====');
const crossDay = watermark.buildLines({
  captureTime: T_UTC,
  recordNo: 'X',
  eventName: 'Y',
});
eq(pick(crossDay, '时间'), '时间：2026-11-21 00:30:00', 'UTC 2026-11-20T16:30Z -> 北京时间 2026-11-21 00:30:00（跨日）');
eq(pick(crossDay, '星期'), '星期：星期六', '跨日后的星期按北京时间计算（星期六）');
ok(/^时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(pick(crossDay, '时间')), '时间格式为 YYYY-MM-DD HH:mm:ss');

const noTime = watermark.buildLines({ recordNo: 'X', eventName: 'Y' });
ok(pick(noTime, '时间').indexOf('时间：') === 0, '未传 captureTime 时仍输出时间行（兜底当前时刻，不崩溃）');
ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(pick(noTime, '时间').slice(3)), '兜底时间格式合法');

// ===== 6. 事件名 =====
console.log('===== 6. eventNameFor =====');
eq(watermark.eventNameFor('DOOR_OPEN', 0), '第1次开门', 'DOOR_OPEN 序号 0 -> 归一到 第1次开门');
eq(watermark.eventNameFor('DOOR_OPEN', 3), '第3次开门', 'DOOR_OPEN 序号 3 -> 第3次开门');
eq(watermark.eventNameFor('DOOR_CLOSE', 3), '第3次关门', 'DOOR_CLOSE 序号 3 -> 第3次关门');
eq(watermark.eventNameFor('DOOR_OPEN', { DOOR_OPEN: 5 }), '第5次开门', '传计数对象 {DOOR_OPEN:5} -> 第5次开门');
eq(watermark.eventNameFor('WAYBILL'), '货运运单', 'WAYBILL -> 货运运单（固定类型不受序号影响）');
eq(watermark.eventNameFor('CARGO_PHOTO', 9), '货物照片', 'CARGO_PHOTO -> 货物照片');
eq(watermark.eventNameFor('LOADED_COMPARTMENT', 1), '装箱完成照片', 'LOADED_COMPARTMENT -> 装箱完成照片');
eq(watermark.eventNameFor('OTHER', 2), '其他照片', 'OTHER -> 其他照片');
eq(watermark.eventNameFor('UNKNOWN_TYPE', 1), '其他照片', '未知类型 -> 其他照片（不抛错）');

// ===== 7. 缺陷 A 实际输出（供人工核对）=====
console.log('===== 7. 无定位场景实际水印（人工核对）=====');
const demo = watermark.buildLines({
  plateNumber: '沪A12345',
  captureTime: 0,
  recordNo: 'X',
  eventName: 'Y',
});
demo.forEach((line) => console.log('    ' + line));

// ===== 8. 排版计算 computeLayout（长地址不再被裁：字号按最长行自适应收缩）=====
console.log('===== 8. 排版 computeLayout（长地址自适应字号）=====')
// 桩测量：CJK/全角按 1.0em、半角按 0.55em，近似 sans-serif 粗体宽度
function stubMeasure(text, size) {
  let w = 0;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    w += s.charCodeAt(i) > 0x2e80 ? size : size * 0.55;
  }
  return w;
}

/**
 * 构造 7 行水印文本
 * @param {string} location 地点行内容（含「地点：」前缀）
 * @returns {string[]} 7 行文本
 */
function makeLines(location) {
  return [
    '车牌：沪A12345',
    '时间：2026-11-21 10:24:36',
    '星期：星期六',
    location,
    '天气：晴 12℃',
    '档案编号：TR2026110001',
    '事件：第1次开门',
  ];
}

const normalLayout = watermark.computeLayout({
  width: 1600, height: 1200, lines: makeLines('地点：' + '永'.repeat(22)), measure: stubMeasure,
});
eq(normalLayout.fontSize, 40, '正常 25 字地址：字号保持 W/40 = 40（不为极端情况把常态图缩小）');
eq(normalLayout.overflows, false, '正常 25 字地址：不超宽');
eq(normalLayout.maxFontSize, 40, 'maxFontSize = round(W/40)');
eq(normalLayout.minFontSize, 16, 'minFontSize = 16');

const long43 = watermark.computeLayout({
  width: 1600, height: 1200, lines: makeLines('地点：' + '永'.repeat(40)), measure: stubMeasure,
});
ok(long43.fontSize < 40, '43 字地址：字号已收缩（< 40）');
ok(long43.fontSize > 16, '43 字地址：字号仍 > 16（未触底限）');
eq(long43.fontSize, 34, '43 字地址：字号收缩到 34（stub 量宽下）');
eq(long43.overflows, false, '43 字地址：收缩后不再超宽（右侧不被裁）');
ok(long43.boxX >= 0, '43 字地址：底色盒不越出左边界');
ok(long43.boxX + long43.boxW <= 1600 + 0.5, '43 字地址：底色盒右边界在画布内');
ok(long43.boxY + long43.boxH <= 1200 + 0.5, '7 行垂直方向不越界');

const long80 = watermark.computeLayout({
  width: 1600, height: 1200, lines: makeLines('地点：' + '永'.repeat(77)), measure: stubMeasure,
});
ok(long80.fontSize >= 16, '80 字地址：字号不低于 16 下限');
eq(long80.overflows, false, '80 字地址：仍能在 16px 以上放下（不裁切）');
ok(long80.boxX + long80.boxW <= 1600 + 0.5, '80 字地址：底色盒右边界在画布内');

const tiny = watermark.computeLayout({
  width: 640, height: 480, lines: makeLines('地点：' + '永'.repeat(40)), measure: stubMeasure,
});
eq(tiny.fontSize, 16, '640x480 + 43 字：缩到 16px 下限');
eq(tiny.overflows, true, '640x480 + 43 字：触底限仍超宽 -> overflows 为 true（走 console.warn 分支）');
ok(tiny.boxX >= 0 && tiny.boxY >= 0, '640x480：底色盒不越出画布左上');

const noMeasure = watermark.computeLayout({ width: 1600, height: 1200, lines: makeLines('地点：x') });
eq(noMeasure.fontSize, 40, '未注入 measure 时不崩溃，字号取 W/40');

const degenerate = watermark.computeLayout({ width: 100, height: 80, lines: makeLines('地点：' + '永'.repeat(40)), measure: stubMeasure });
ok(degenerate.boxX >= 0 && degenerate.boxY >= 0, '极小画布：坐标不为负');

// ===== 汇总 =====
console.log('');
console.log('结果：' + passCount + ' 通过，' + failCount + ' 失败');
if (failCount > 0) {
  process.exit(1);
}
