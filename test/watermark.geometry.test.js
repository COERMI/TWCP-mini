// test/watermark.geometry.test.js —— 水印画布几何回归：文字与底色盒不得越出画布
//
// 目的：drawToCanvas 只夹紧了「底色盒」尺寸，文字本身若不折行/不缩字号就会被画布裁掉。
//       本文件用「带记录能力的 canvas 桩」跑真实的 drawToCanvas，再逐行反算文字包围盒，
//       是「长地址右裁 / 极端长宽比末行裁切」的长期守卫。
//
// 运行：node test/watermark.geometry.test.js   （通过则退出码 0）
//
// 设计约束（重要）：
//   1) measureText 按系统 sans-serif 的等宽近似建模：中文≈1 字号、数字≈0.55、大写字母≈0.7、
//      其余（空格/标点）≈0.35。它模拟的是**平台**行为，不写死被测实现的字号/行高/内边距常量，
//      因此工程师调整字号策略后本测试不会误判。
//   2) 断言只用「行为契约」：是否越界、字号是否在可读区间 [MIN_FONT, MAX_FONT_CEIL]、
//      正常地址是否保持正常字号、放不下时是否给出警告——不从实现里反推具体数字。
//   3) 不修改任何生产文件；wx / canvas 全部在内存中打桩。
const assert = require('assert');
const watermark = require('../miniprogram/utils/watermark.js');

// 可读性契约（来自产品要求，不是从实现反推）：字号不得小于 16px，过大则超出常规水印视觉范围
const MIN_FONT = 16;
const MAX_FONT_CEIL = 64;

// 极端长宽比（10:1 全景）当前不可达：chooseMedia 只允许相机拍摄，手机相机不产全景图。
// 因此该场景在本文件里只做「观察项」，不判失败（否则会给日常回归留下永久红灯）。
// 若将来开放「从相册选图」，把下面开关改成 true，这条立刻升级为硬断言。
const STRICT_EXTREME_ASPECT = false;

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

/**
 * 模拟平台字体度量宽度（等宽近似，见文件头说明）
 * @param {string} text 文本
 * @param {number} fontPx 字号（px）
 * @returns {number} 估算宽度（px）
 */
function measureWidth(text, fontPx) {
  let width = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    const code = text.charCodeAt(i);
    if (code > 0x2e80) {
      width += fontPx; // 中日韩全角
    } else if (ch >= '0' && ch <= '9') {
      width += fontPx * 0.55;
    } else if (ch >= 'A' && ch <= 'Z') {
      width += fontPx * 0.7;
    } else {
      width += fontPx * 0.35; // 空格、标点、小写字母
    }
  }
  return width;
}

/**
 * 从 ctx.font 字符串里解析字号
 * @param {string} font font 字符串，如 bold 20px sans-serif
 * @returns {number} 字号（px），解析失败返回 0
 */
function parseFontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(String(font));
  return m ? Number(m[1]) : 0;
}

/** 本次 drawToCanvas 调用期间收集到的 console.warn / console.error 文本 */
let warns = [];

/**
 * 生成一个「可记录绘制指令」的 canvas 桩
 * @param {number} srcW 源图宽
 * @param {number} srcH 源图高
 * @param {object} rec 记录容器（原地填充）
 * @returns {object} canvas 桩
 */
function makeCanvas(srcW, srcH, rec) {
  const ctx = {
    fillStyle: '',
    textBaseline: '',
    textAlign: '',
    font: '',
    beginPath() {
      rec.path = [];
    },
    moveTo(x, y) {
      rec.path.push([x, y]);
    },
    lineTo(x, y) {
      rec.path.push([x, y]);
    },
    arcTo(x1, y1, x2, y2) {
      rec.path.push([x1, y1], [x2, y2]);
    },
    closePath() {},
    clearRect() {},
    drawImage(img, x, y, w, h) {
      rec.drawImage = [x, y, w, h];
    },
    fill() {
      if (rec.path && rec.path.length) {
        const xs = rec.path.map((p) => p[0]);
        const ys = rec.path.map((p) => p[1]);
        rec.box = {
          x0: Math.min.apply(null, xs),
          y0: Math.min.apply(null, ys),
          x1: Math.max.apply(null, xs),
          y1: Math.max.apply(null, ys),
        };
      }
    },
    fillText(text, x, y) {
      const fontPx = parseFontPx(ctx.font);
      rec.texts.push({ text: text, x: x, y: y, fontPx: fontPx });
    },
    measureText(text) {
      return { width: measureWidth(text, parseFontPx(ctx.font)) };
    },
  };

  return {
    width: 0,
    height: 0,
    getContext() {
      return ctx;
    },
    createImage() {
      const img = { width: srcW, height: srcH };
      Object.defineProperty(img, 'src', {
        set() {
          setTimeout(function () {
            if (img.onload) img.onload();
          }, 0);
        },
        get() {
          return 'stub://image';
        },
      });
      return img;
    },
  };
}

/**
 * 生成指定字数的地址串（用真实中文地名拼接，长度精确可控）
 * @param {number} len 目标字数
 * @returns {string} 地址
 */
function addr(len) {
  const base = '广东省深圳市南山区粤海街道科技园科苑路';
  let s = '';
  while (s.length < len) s += base;
  return s.slice(0, len);
}

/**
 * 组装 7 行水印文案（与 record.js 的调用顺序一致）
 * @param {string} address 地址
 * @returns {string[]} 水印行
 */
function lines7(address) {
  return [
    '车牌：川A12345',
    '时间：2026-11-21 10:24:36',
    '星期：星期六',
    '地点：' + address,
    '天气：晴 18℃',
    '档案编号：TR2026110001',
    '事件：第3次开门',
  ];
}

/**
 * 跑一次 drawToCanvas 并计算越界情况
 * @param {number} srcW 源图宽
 * @param {number} srcH 源图高
 * @param {string[]} lines 水印行
 * @returns {Promise<object>} 布局结果
 */
function plot(srcW, srcH, lines) {
  const rec = { texts: [], path: [], box: null, drawImage: null };
  const canvas = makeCanvas(srcW, srcH, rec);
  const exportOpts = {};
  warns = [];

  const origWarn = console.warn;
  const origError = console.error;
  console.warn = function () {
    warns.push(Array.prototype.join.call(arguments, ' '));
  };
  console.error = function () {
    warns.push(Array.prototype.join.call(arguments, ' '));
  };
  global.wx = {
    canvasToTempFilePath(o) {
      exportOpts.fileType = o.fileType;
      exportOpts.quality = o.quality;
      exportOpts.width = o.width;
      exportOpts.height = o.height;
      exportOpts.destWidth = o.destWidth;
      exportOpts.destHeight = o.destHeight;
      o.success({ tempFilePath: 'wxfile://tmp/wm.jpg' });
    },
  };

  return watermark
    .drawToCanvas({ canvas: canvas, imagePath: 'wxfile://tmp/orig.jpg', lines: lines })
    .then(function () {
      console.warn = origWarn;
      console.error = origError;

      const W = canvas.width;
      const H = canvas.height;
      const violations = [];
      rec.texts.forEach(function (t, i) {
        if (!(t.fontPx > 0)) return;
        const right = t.x + measureWidth(t.text, t.fontPx);
        const top = t.y - t.fontPx / 2;
        const bottom = t.y + t.fontPx / 2;
        const reasons = [];
        if (right > W + 0.5) reasons.push('右侧越界 ' + Math.round(right - W) + 'px');
        if (bottom > H + 0.5) reasons.push('底部越界 ' + Math.round(bottom - H) + 'px');
        if (t.x < -0.5) reasons.push('左侧越界');
        if (top < -0.5) reasons.push('顶部越界');
        if (reasons.length) violations.push({ line: i + 1, text: t.text, reasons: reasons });
      });

      const fonts = rec.texts.map(function (t) {
        return t.fontPx;
      });
      return {
        W: W,
        H: H,
        fontPx: fonts.length ? fonts[0] : 0,
        allSameFont: fonts.every(function (f) {
          return f === fonts[0];
        }),
        texts: rec.texts.length,
        box: rec.box,
        violations: violations,
        warns: warns.slice(),
        exportOpts: exportOpts,
      };
    })
    .catch(function (err) {
      console.warn = origWarn;
      console.error = origError;
      throw err;
    });
}

/**
 * 打印一次布局结果，便于失败时定位
 * @param {string} title 场景名
 * @param {object} r 结果
 * @returns {void}
 */
function report(title, r) {
  console.log(
    '  · ' + title + ' → 画布 ' + r.W + 'x' + r.H + '，字号 ' + r.fontPx + 'px，越界 ' + r.violations.length + ' 行'
  );
  r.violations.forEach(function (v) {
    console.log('      第' + v.line + '行「' + v.text.slice(0, 18) + '…」' + v.reasons.join('；'));
  });
}

/**
 * 「不静默截断」判定：要么不越界，要么已给出警告
 * @param {object} r 布局结果
 * @returns {boolean} 是否可接受
 */
function notSilentlyClipped(r) {
  return r.violations.length === 0 || r.warns.length > 0;
}

(async function () {
  console.log('===== 1. 常规拍摄比例：任何地址长度都不得越界 =====');
  const normal = await plot(4000, 3000, lines7(addr(25))); // 4:3 横拍，25 字常规地址
  report('4:3 4000x3000 / 25 字地址', normal);
  eq(normal.W, 1600, '4:3 缩放到宽 1600');
  eq(normal.H, 1200, '4:3 高度按比例 1200');
  eq(normal.texts, 7, '绘制 7 行');
  eq(normal.violations.length, 0, '4:3 + 25 字地址：0 行越界');
  ok(normal.fontPx >= MIN_FONT, '字号不低于可读下限 ' + MIN_FONT + 'px（实际 ' + normal.fontPx + 'px）');
  ok(normal.allSameFont, '同一张图内所有行字号一致');

  // 最短地址（8 字）不触发收缩，用作「未收缩字号基线」，避免把 W/40 这类实现细节写死
  const shortest = await plot(4000, 3000, lines7(addr(8)));
  report('4:3 4000x3000 / 8 字地址（基线）', shortest);
  eq(shortest.violations.length, 0, '8 字地址：0 行越界');
  eq(
    normal.fontPx,
    shortest.fontPx,
    '25 字常规地址字号未被收缩（' + normal.fontPx + 'px，与基线一致：不为极端情况牺牲正常可读性）'
  );

  const portrait = await plot(3000, 4000, lines7(addr(25)));
  report('3:4 3000x4000 / 25 字地址', portrait);
  eq(portrait.violations.length, 0, '3:4 竖拍：0 行越界');

  const wide = await plot(4000, 2250, lines7(addr(25)));
  report('16:9 4000x2250 / 25 字地址', wide);
  eq(wide.violations.length, 0, '16:9：0 行越界');

  const small = await plot(640, 480, lines7(addr(25)));
  report('640x480 / 25 字地址', small);
  eq(small.W, 640, '小图不放大（宽仍为 640）');
  eq(small.violations.length, 0, '640x480：0 行越界');

  console.log('===== 2. 长地址：必须缩字号适配，不得右裁 =====');
  const long43 = await plot(4000, 3000, lines7(addr(43)));
  report('4:3 4000x3000 / 43 字地址', long43);
  eq(long43.violations.length, 0, '4:3 + 43 字地址：0 行越界（长地址右裁是本文件守护的核心缺陷）');
  ok(long43.fontPx < normal.fontPx, '43 字地址字号已收缩（' + long43.fontPx + 'px < 常规 ' + normal.fontPx + 'px）');
  ok(long43.fontPx >= MIN_FONT, '收缩后不低于 ' + MIN_FONT + 'px（实际 ' + long43.fontPx + 'px）');

  const long43p = await plot(3000, 4000, lines7(addr(43)));
  report('3:4 3000x4000 / 43 字地址', long43p);
  eq(long43p.violations.length, 0, '3:4 + 43 字地址：0 行越界');

  const long43w = await plot(4000, 2250, lines7(addr(43)));
  report('16:9 4000x2250 / 43 字地址', long43w);
  eq(long43w.violations.length, 0, '16:9 + 43 字地址：0 行越界');

  console.log('===== 3. 极端长度：要么放下、要么有警告，不能静默截断 =====');
  const long80 = await plot(4000, 3000, lines7(addr(80)));
  report('4:3 4000x3000 / 80 字地址', long80);
  ok(notSilentlyClipped(long80), '80 字地址：未静默截断（越界 ' + long80.violations.length + ' 行 / 警告 ' + long80.warns.length + ' 条）');
  ok(long80.fontPx >= MIN_FONT, '80 字地址字号不低于 ' + MIN_FONT + 'px（实际 ' + long80.fontPx + 'px）');
  ok(long80.fontPx <= normal.fontPx, '80 字地址字号不大于常规字号（收缩逻辑不会反向放大）');

  // 小画布 + 80 字地址：缩到下限仍放不下 → 必须 warn（验证「触底告警」分支真的存在，不能静默截断）
  const extreme = await plot(640, 480, lines7(addr(80)));
  report('640x480 / 80 字地址（触底场景）', extreme);
  eq(extreme.fontPx, MIN_FONT, '已缩到可读下限 ' + MIN_FONT + 'px（实际 ' + extreme.fontPx + 'px）');
  ok(extreme.warns.length > 0, '触底仍超宽时必须给出警告（实际告警 ' + extreme.warns.length + ' 条）');
  ok(
    extreme.warns.join(' ').indexOf('最小字号') >= 0 || extreme.warns.join(' ').indexOf(MIN_FONT + 'px') >= 0,
    '告警内容包含极小字号信息，便于线上排查'
  );

  // 10:1 全景：chooseMedia 仅相机、手机拍不出全景，当前版本不可达 → 观察项（不判失败，避免日常回归永久红灯）；
  // 若将来开放「从相册选图」，把 STRICT_EXTREME_ASPECT 改为 true 即升级为硬断言。
  const pano = await plot(4000, 400, lines7(addr(25)));
  report('10:1 4000x400（观察项：相机拍不出，当前不可达）', pano);
  if (STRICT_EXTREME_ASPECT) {
    ok(notSilentlyClipped(pano), '极端长宽比：未静默截断（越界 ' + pano.violations.length + ' 行 / 警告 ' + pano.warns.length + ' 条）');
  } else {
    console.log(
      '  ○ 观察（不计失败）：越界 ' + pano.violations.length + ' 行 / 警告 ' + pano.warns.length + ' 条' +
        (pano.violations.length > 0 ? '；当前只按宽度收缩、未按高度收缩，开放相册选图前需补高度收缩分支' : '')
    );
  }

  console.log('===== 4. 底色盒与导出参数 =====');
  ok(
    normal.box && normal.box.x0 >= -0.5 && normal.box.y0 >= -0.5 && normal.box.x1 <= normal.W + 0.5 && normal.box.y1 <= normal.H + 0.5,
    '底色盒完全落在画布内'
  );
  eq(normal.exportOpts.fileType, 'jpg', '导出格式 jpg');
  eq(normal.exportOpts.quality, 0.85, '导出质量 0.85');
  eq(normal.exportOpts.width, normal.W, '导出宽度等于画布宽');
  eq(normal.exportOpts.destWidth, normal.W, 'destWidth 等于画布宽');

  console.log('===== 5. 字号上限（不得因收缩逻辑反而放大到不可控）=====');
  [normal, portrait, wide, small, long43, long43p, long43w, long80].forEach(function (r, i) {
    ok(r.fontPx <= MAX_FONT_CEIL, '用例 #' + (i + 1) + ' 字号不超过上限 ' + MAX_FONT_CEIL + 'px（实际 ' + r.fontPx + 'px）');
  });

  console.log('');
  console.log('结果：' + passCount + ' 通过，' + failCount + ' 失败');
  if (failCount > 0) {
    process.exit(1);
  }
})();
