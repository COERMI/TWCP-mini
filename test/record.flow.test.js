// test/record.flow.test.js —— 采集页 uploadCurrent 全流程回归（wx / 云调用全部打桩）
//
// 目的：把「水印生成失败/超时不得阻断上传」这条产品契约固化成可重复执行的测试。
//       覆盖：成功路径、canvas 节点缺失、绘制 reject、导出失败、getEnvInfo 失败、
//             定位被拒、canvas 回调永挂（超时兜底）、同一实例连续上传的降级标志重置、toast 时序。
//
// 运行：node test/record.flow.test.js   （通过则退出码 0；含一个真超时用例，约耗时 WM_TIMEOUT_MS）
//
// 设计约束：
//   1) 全部用内存桩，不连云、不依赖 wx SDK、无第三方依赖。
//   2) 超时断言从源码读取 WM_TIMEOUT_MS，不写死毫秒数——工程师调整该常量不会让本测试假红。
//   3) 只断言「行为」（是否上传、上传几张、watermarked_file_id 是否为空、提示文案、标志位），
//      不断言实现细节（不检查内部函数名、行号、绘制指令顺序）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RECORD_PATH = path.join(ROOT, 'miniprogram', 'pages', 'record', 'record.js');

// 从源码解析超时常量（不写死数字）
const timeoutMatch = /const\s+WM_TIMEOUT_MS\s*=\s*(\d+)\s*;/.exec(fs.readFileSync(RECORD_PATH, 'utf8'));
const WM_TIMEOUT_MS = timeoutMatch ? Number(timeoutMatch[1]) : 0;

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
    assert.deepStrictEqual(actual, expected);
    passCount += 1;
    console.log('  ✓ ' + label);
  } catch (e) {
    failCount += 1;
    console.log('  ✗ ' + label + '（期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual) + '）');
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
    console.log('  ✗ ' + label);
  }
}

// ===== 打桩环境 =====
const log = { toasts: [], modals: [], calls: [], uploads: [], loading: 0, timeline: [] };
let canvasMode = 'ok'; // ok | no-node | no-create-image | image-error | export-fail | hang
let envInfoMode = 'ok'; // ok | reject | nulls
let locMode = 'ok'; // ok | deny
let nodeResult = { node: null, width: 300, height: 300 };

/**
 * 造一个 canvas 桩；mode 控制各失败路径
 * @returns {object} canvas 节点桩
 */
function makeCanvasNode() {
  const image = { width: 1200, height: 900, onload: null, onerror: null };
  Object.defineProperty(image, 'src', {
    set() {
      if (canvasMode === 'hang') return; // 永不回调：模拟 canvasToTempFilePath 既不 success 也不 fail
      setTimeout(function () {
        if (canvasMode === 'image-error') {
          if (image.onerror) image.onerror();
        } else if (image.onload) {
          image.onload();
        }
      }, 0);
    },
    get() {
      return 'stub://image';
    },
  });

  const ctx = {
    font: '',
    fillStyle: '',
    textBaseline: '',
    textAlign: '',
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    closePath() {},
    clearRect() {},
    drawImage() {},
    fill() {},
    fillText() {},
    measureText(t) {
      return { width: String(t).length * 10 };
    },
  };

  const node = { width: 0, height: 0, getContext: () => ctx };
  if (canvasMode !== 'no-create-image') node.createImage = () => image;
  return node;
}

/** 记录页面配置（record.js 加载时调用 Page(...)） */
let pageCfg = null;
global.Page = function (cfg) {
  pageCfg = cfg;
};

global.wx = {
  getStorageSync() {
    return null;
  },
  setStorageSync() {},
  showLoading() {
    log.loading += 1;
    log.timeline.push('showLoading');
  },
  hideLoading() {
    log.loading -= 1;
    log.timeline.push('hideLoading');
  },
  showToast(o) {
    log.toasts.push(o.title);
    log.timeline.push('toast:' + o.title);
  },
  showModal(o) {
    log.modals.push(o.title + '|' + o.content);
  },
  stopPullDownRefresh() {},
  getLocation(o) {
    if (locMode === 'deny') {
      o.fail({ errMsg: 'getLocation:fail auth deny' });
    } else {
      o.success({ latitude: 22.543096, longitude: 114.057865, accuracy: 15 });
    }
  },
  openSetting(o) {
    o.success({ authSetting: {} });
  },
  chooseMedia() {},
  createSelectorQuery() {
    const q = {
      select() {
        return q;
      },
      fields() {
        return q;
      },
      exec(cb) {
        setTimeout(function () {
          cb([nodeResult]);
        }, 0);
      },
    };
    return q;
  },
  canvasToTempFilePath(o) {
    if (canvasMode === 'export-fail') {
      o.fail({ errMsg: 'canvasToTempFilePath:fail empty canvas' });
    } else {
      o.success({ tempFilePath: 'wxfile://tmp/wm-output.jpg' });
    }
  },
  cloud: {
    callFunction(o) {
      log.calls.push({ name: o.name, data: o.data });
      if (o.name === 'getEnvInfo') {
        if (envInfoMode === 'reject') {
          o.success({ result: { success: false, code: 'FORBIDDEN', message: '无权操作该档案' } });
        } else if (envInfoMode === 'nulls') {
          o.success({ result: { success: true, data: { weather: null, temperature: null, location_text: null } } });
        } else {
          o.success({ result: { success: true, data: { weather: '晴', temperature: 18, location_text: '' } } });
        }
      } else if (o.name === 'uploadPhoto') {
        o.success({ result: { success: true, data: { photo_id: 'p1' } } });
      } else if (o.name === 'getRecord') {
        o.success({
          result: {
            success: true,
            data: {
              record: { _id: 'r1', record_no: 'TR2026110001', plate_number: '川A12345', status: 'active' },
              events: [
                { event_type: 'WAYBILL', photo_count: 1, event_no: 1 },
                { event_type: 'DOOR_OPEN', photo_count: 1, event_no: 1 },
                { event_type: 'DOOR_OPEN', photo_count: 1, event_no: 2 },
              ],
            },
          },
        });
      } else {
        o.success({ result: { success: true, data: {} } });
      }
    },
    uploadFile(o) {
      log.uploads.push(o.cloudPath);
      o.success({ fileID: 'cloud://test-bucket/' + o.cloudPath });
    },
  },
};

require(RECORD_PATH);

/**
 * 重置打桩状态
 * @returns {void}
 */
function reset() {
  log.toasts.length = 0;
  log.modals.length = 0;
  log.calls.length = 0;
  log.uploads.length = 0;
  log.timeline.length = 0;
  log.loading = 0;
}

/**
 * 造一个 Page 实例（带 setData / 预置档案与预览状态）
 * @returns {object} 页面实例
 */
function makePage() {
  const page = Object.assign(Object.create(null), pageCfg);
  page.data = JSON.parse(JSON.stringify(pageCfg.data));
  page.setData = function (patch) {
    Object.assign(page.data, patch);
  };
  page.captureTime = Date.parse('2026-11-20T16:30:00Z'); // UTC 16:30 -> 北京时间次日 00:30
  page.data.record = { _id: 'r1', record_no: 'TR2026110001', plate_number: '川A12345', status: 'active' };
  page.data.recordNo = 'TR2026110001';
  page.data.doorOpenCount = 2; // 已有 2 次开门 -> 本次应为第 3 次
  page.data.preview = { visible: true, tempPath: 'wxfile://tmp/orig.jpg', eventType: 'DOOR_OPEN', eventName: '开门' };
  page.getToken = function () {
    return 'tok-1';
  };
  return page;
}

/**
 * 屏蔽被测代码的 console 噪音，同时收集告警文本
 * @param {function(): Promise} fn 执行体
 * @returns {Promise<{result:*, warns:string[]}>} 结果与告警
 */
function quiet(fn) {
  const warns = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = function () {
    warns.push(Array.prototype.join.call(arguments, ' '));
  };
  console.error = function () {
    warns.push(Array.prototype.join.call(arguments, ' '));
  };
  return Promise.resolve()
    .then(fn)
    .then(
      function (result) {
        console.warn = origWarn;
        console.error = origError;
        return { result: result, warns: warns };
      },
      function (err) {
        console.warn = origWarn;
        console.error = origError;
        throw err;
      }
    );
}

/**
 * 执行一次上传并抓取水印行（拦截 drawToCanvas，仅运行时打桩，不改项目文件）
 * @param {object} page 页面实例
 * @returns {Promise<object>} 抓取结果
 */
function runUpload(page) {
  const watermark = require(path.join(ROOT, 'miniprogram', 'utils', 'watermark.js'));
  const origDraw = watermark.drawToCanvas;
  let drawnLines = null;
  watermark.drawToCanvas = function (opts) {
    drawnLines = opts.lines ? opts.lines.slice() : null;
    return origDraw.call(null, opts);
  };
  return quiet(function () {
    return page.uploadCurrent();
  }).then(function (r) {
    watermark.drawToCanvas = origDraw;
    return {
      lines: drawnLines,
      warns: r.warns,
      uploadCalls: log.calls.filter(function (c) {
        return c.name === 'uploadPhoto';
      }),
      uploads: log.uploads.slice(),
      toasts: log.toasts.slice(),
      modals: log.modals.slice(),
      timeline: log.timeline.slice(),
      loading: log.loading,
      uploading: page.data.uploading,
    };
  });
}

(async function () {
  console.log('===== 1. 成功路径：水印 7 行 + 双图上传 + 字段齐全 =====');
  canvasMode = 'ok';
  envInfoMode = 'ok';
  locMode = 'ok';
  nodeResult = { node: makeCanvasNode(), width: 300, height: 300 };
  reset();
  const okRun = await runUpload(makePage());
  eq(okRun.lines, [
    '车牌：川A12345',
    '时间：2026-11-21 00:30:00',
    '星期：星期六',
    '地点：22.543096,114.057865',
    '天气：晴 18℃',
    '档案编号：TR2026110001',
    '事件：第3次开门',
  ], '水印 7 行内容与顺序正确（含北京时间/经纬度兜底/序号=已有+1）');
  eq(okRun.uploads.length, 2, '上传原图 + 水印图两张');
  ok(okRun.uploads[0].indexOf('-orig-') > 0, '第一张命名含 -orig-');
  ok(okRun.uploads[1].indexOf('-wm-') > 0, '第二张命名含 -wm-');
  eq(okRun.uploadCalls.length, 1, '调用 uploadPhoto 一次');
  eq(okRun.uploadCalls[0].data.watermarked_file_id.indexOf('cloud://'), 0, 'watermarked_file_id 为合法 cloud:// fileID');
  eq(okRun.uploadCalls[0].data.latitude, 22.543096, 'latitude 已上报');
  eq(okRun.uploadCalls[0].data.temperature, 18, 'temperature 已上报');
  eq(okRun.toasts, ['上传成功'], '成功路径只提示「上传成功」');
  eq(okRun.uploading, false, 'uploading 已复位');
  eq(okRun.loading, 0, 'loading 已关闭');

  console.log('===== 2. 定位被拒：不阻断上传，水印不得出现假坐标 =====');
  canvasMode = 'ok';
  envInfoMode = 'nulls';
  locMode = 'deny';
  nodeResult = { node: makeCanvasNode(), width: 300, height: 300 };
  reset();
  const noLoc = await runUpload(makePage());
  eq(noLoc.lines, [
    '车牌：川A12345',
    '时间：2026-11-21 00:30:00',
    '星期：星期六',
    '地点：定位未获取',
    '天气：暂不可用',
    '档案编号：TR2026110001',
    '事件：第3次开门',
  ], '定位失败时水印为「地点：定位未获取 / 天气：暂不可用」，不得出现 0.000000,0.000000');
  eq(noLoc.uploadCalls.length, 1, '仍完成 uploadPhoto 调用（不阻断上传）');
  eq(noLoc.uploadCalls[0].data.latitude, null, '纬度按 null 上报（云端不写假坐标）');
  eq(noLoc.uploadCalls[0].data.longitude, null, '经度按 null 上报');
  ok(noLoc.toasts.indexOf('定位未获取') >= 0, '给出「定位未获取」提示');

  console.log('===== 3. getEnvInfo 失败（FORBIDDEN）：天气降级、地点用经纬度 =====');
  canvasMode = 'ok';
  envInfoMode = 'reject';
  locMode = 'ok';
  nodeResult = { node: makeCanvasNode(), width: 300, height: 300 };
  reset();
  const envFail = await runUpload(makePage());
  eq(envFail.uploadCalls.length, 1, '环境信息失败仍完成上传');
  eq(envFail.lines[3], '地点：22.543096,114.057865', '地点降级为经纬度');
  eq(envFail.lines[4], '天气：暂不可用', '天气降级为暂不可用');
  eq(envFail.uploadCalls[0].data.weather, null, 'weather 按 null 入库');

  console.log('===== 4. canvas 三条失败路径：回退原图、不阻断、提示如实 =====');
  const failCases = [
    ['canvas 节点缺失', 'no-node', null],
    ['绘制 reject（图片加载失败）', 'image-error', 'node'],
    ['导出失败（canvasToTempFilePath fail）', 'export-fail', 'node'],
  ];
  for (const c of failCases) {
    canvasMode = c[1];
    envInfoMode = 'nulls';
    locMode = 'ok';
    nodeResult = { node: c[2] ? makeCanvasNode() : null, width: 300, height: 300 };
    reset();
    const r = await runUpload(makePage());
    eq(r.uploadCalls.length, 1, c[0] + '：仍完成上传');
    eq(r.uploads.length, 1, c[0] + '：只上传原图');
    eq(r.uploadCalls[0].data.watermarked_file_id, '', c[0] + '：watermarked_file_id 为空串（云端回退原图）');
    eq(r.modals.length, 0, c[0] + '：不弹「上传失败」');
    eq(r.toasts, ['已上传原图（水印未生成）'], c[0] + '：提示如实（不误报「上传成功」）');
    eq(r.uploading, false, c[0] + '：uploading 已复位');
  }

  console.log('===== 5. canvas 回调永挂：超时兜底（耗时从源码 WM_TIMEOUT_MS 取）=====');
  ok(WM_TIMEOUT_MS > 0, '源码中存在 WM_TIMEOUT_MS 常量（实际 ' + WM_TIMEOUT_MS + 'ms）');
  canvasMode = 'hang';
  envInfoMode = 'nulls';
  locMode = 'ok';
  nodeResult = { node: makeCanvasNode(), width: 300, height: 300 };
  reset();
  const t0 = Date.now();
  const hangRun = await runUpload(makePage());
  const cost = Date.now() - t0;
  eq(hangRun.uploadCalls.length, 1, '回调永挂时仍完成上传（不会永久卡住）');
  eq(hangRun.uploads.length, 1, '只上传原图');
  eq(hangRun.uploadCalls[0].data.watermarked_file_id, '', 'watermarked_file_id 为空串');
  ok(cost >= WM_TIMEOUT_MS - 500, '在超时点放行（实测 ' + cost + 'ms ≥ ' + WM_TIMEOUT_MS + 'ms - 500ms）');
  ok(cost <= WM_TIMEOUT_MS + 3000, '未明显超出超时点（实测 ' + cost + 'ms）');
  eq(hangRun.loading, 0, 'loading 已关闭');
  eq(hangRun.uploading, false, 'uploading 已复位');
  ok(hangRun.toasts.indexOf('已上传原图（水印未生成）') >= 0, '给出降级提示');

  console.log('===== 6. 同一实例连续上传：降级标志必须归零 =====');
  canvasMode = 'no-node';
  envInfoMode = 'nulls';
  locMode = 'ok';
  nodeResult = { node: null, width: 300, height: 300 };
  reset();
  const page2 = makePage();
  const first = await runUpload(page2);
  const flagAfterFirst = page2.watermarkFallback;
  reset();
  canvasMode = 'ok';
  nodeResult = { node: makeCanvasNode(), width: 300, height: 300 };
  page2.data.preview = { visible: true, tempPath: 'wxfile://tmp/orig2.jpg', eventType: 'DOOR_CLOSE', eventName: '关门' };
  const second = await runUpload(page2);
  eq(first.toasts, ['已上传原图（水印未生成）'], '第一次降级：提示已上传原图');
  eq(flagAfterFirst, true, '第一次降级后标志为 true');
  eq(second.toasts, ['上传成功'], '第二次成功：提示回到「上传成功」（标志已归零）');
  eq(page2.watermarkFallback, false, '第二次上传后标志为 false');
  eq(second.uploads.length, 2, '第二次正常上传了原图 + 水印图两张');

  console.log('===== 7. toast 时序：必须晚于 hideLoading，且一次上传只弹一条 =====');
  const tl = first.timeline;
  const hideIdx = tl.lastIndexOf('hideLoading');
  const toastIdx = tl.findIndex(function (x) {
    return x.indexOf('toast:') === 0;
  });
  ok(hideIdx >= 0 && toastIdx > hideIdx, 'toast 在 hideLoading 之后（否则会被吞掉，时序=' + JSON.stringify(tl) + '）');
  eq(first.toasts.length, 1, '降级场景只弹 1 条 toast');
  eq(okRun.toasts.length, 1, '成功场景只弹 1 条 toast');

  console.log('===== 8. 契约：uploadPhoto 入参字段集合未变 =====');
  eq(
    Object.keys(okRun.uploadCalls[0].data).sort(),
    [
      'access_token', 'accuracy', 'device_capture_time', 'event_type', 'file_id',
      'latitude', 'location_text', 'longitude', 'record_no', 'remark',
      'temperature', 'watermarked_file_id', 'weather',
    ],
    'uploadPhoto 入参 13 个字段名与云函数读取字段一致'
  );

  console.log('');
  console.log('结果：' + passCount + ' 通过，' + failCount + ' 失败');
  if (failCount > 0) {
    process.exit(1);
  }
})();
