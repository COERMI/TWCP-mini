// test/logic.test.js —— 本地纯逻辑测试（无需云环境、无需 wx SDK）
// 运行：node test/logic.test.js
const assert = require('assert');
const plate = require('../miniprogram/utils/plate');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    console.log('  ✗ ' + name + ' -> ' + e.message);
  }
}

console.log('===== 1. 车牌号校验 =====');
const cases = [
  ['川A12345', true], // 标准蓝牌 7 位
  ['粤B12345D', true], // 新能源 8 位
  ['京AD12345', true], // 新能源 8 位（第2位字母）
  ['川A1234挂', true], // 挂车
  ['川A1234学', true], // 教练车
  ['ABC123', false], // 首位非省份简称
  ['川112345', false], // 第2位非字母
  ['川A1O345', false], // 含字母 O
  ['川A1I345', false], // 含字母 I
  ['川A123', false], // 过短
  ['川A12345678', false], // 过长（9 位）
  ['', false], // 空
];
cases.forEach(([input, expected]) => {
  check('validatePlate(' + input + ') => ' + expected, () => {
    const r = plate.validatePlate(input);
    assert.strictEqual(r.ok, expected, '输入=' + input + ' 实际=' + r.ok + ' msg=' + r.msg);
  });
});

console.log('===== 2. 键盘类型切换 =====');
check('空 -> province', () => assert.strictEqual(plate.keyboardTypeFor(''), 'province'));
check('川 -> letter', () => assert.strictEqual(plate.keyboardTypeFor('川'), 'letter'));
check('川A -> alnum', () => assert.strictEqual(plate.keyboardTypeFor('川A'), 'alnum'));

console.log('===== 3. 事件名生成（对齐云函数逻辑）=====');
function eventNameFor(type, seq) {
  if (type === 'DOOR_OPEN') return '第' + seq + '次开门';
  if (type === 'DOOR_CLOSE') return '第' + seq + '次关门';
  return {
    WAYBILL: '货运运单',
    CARGO_PHOTO: '货物照片',
    LOADED_COMPARTMENT: '装箱完成照片',
    OTHER: '其他照片',
  }[type] || '其他照片';
}
check('第2次开门', () => assert.strictEqual(eventNameFor('DOOR_OPEN', 2), '第2次开门'));
check('第3次关门', () => assert.strictEqual(eventNameFor('DOOR_CLOSE', 3), '第3次关门'));
check('货运运单', () => assert.strictEqual(eventNameFor('WAYBILL', 1), '货运运单'));
check('装箱完成照片', () => assert.strictEqual(eventNameFor('LOADED_COMPARTMENT', 1), '装箱完成照片'));

console.log('===== 4. 档案编号格式 =====');
function genRecordNoLike(ym, seq) {
  return 'TR' + ym + String(seq).padStart(4, '0');
}
check('TR2026120001', () => assert.strictEqual(genRecordNoLike('202612', 1), 'TR2026120001'));
check('TR2026120123', () => assert.strictEqual(genRecordNoLike('202612', 123), 'TR2026120123'));

console.log('===== 5. 水印行内容（对齐云函数逻辑）=====');
function buildWatermarkLines(ctx) {
  const lines = [];
  if (ctx.plateNumber) lines.push('车牌：' + ctx.plateNumber);
  lines.push('时间：' + ctx.time);
  lines.push('星期：' + ctx.weekday);
  lines.push(ctx.locationText ? '地点：' + ctx.locationText : '地点：定位未获取');
  lines.push(ctx.weather ? '天气：' + ctx.weather + (ctx.temperature != null ? ' ' + ctx.temperature + '℃' : '') : '天气：暂不可用');
  lines.push('档案编号：' + ctx.recordNo);
  lines.push('事件：' + ctx.eventName);
  return lines;
}
check('完整水印 7 行', () => {
  const lines = buildWatermarkLines({
    plateNumber: '川A12345', time: '2026-12-01 12:30:25', weekday: '星期二',
    locationText: '四川省成都市', weather: '多云', temperature: 18,
    recordNo: 'TR2026120001', eventName: '第2次开门',
  });
  assert.strictEqual(lines.length, 7);
  assert.strictEqual(lines[6], '事件：第2次开门');
});
check('定位/天气缺失时降级', () => {
  const lines = buildWatermarkLines({
    plateNumber: '川A12345', time: 'x', weekday: 'x',
    locationText: null, weather: null, temperature: null,
    recordNo: 'TR2026120001', eventName: '开门',
  });
  assert.ok(lines.indexOf('地点：定位未获取') >= 0);
  assert.ok(lines.indexOf('天气：暂不可用') >= 0);
});

console.log('');
console.log('结果：' + pass + ' 通过，' + fail + ' 失败');
if (fail > 0) process.exit(1);
