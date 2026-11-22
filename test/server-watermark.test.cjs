const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('../cloudfunctions/imagePipelineProbe/node_modules/sharp');
const { render, linesFor, MAX_BYTES } = require('../cloudfunctions/imagePipelineProbe/renderer');
const { fixture, CASES } = require('../cloudfunctions/imagePipelineProbe/fixtures');
const evidence = path.join(__dirname, '../docs/evidence/2026-11-22/watermark-local');
const context = {
  plate: '粤B12345', recordNo: 'TEST-20261122-0001', eventName: '第1次开门',
  captureTime: '2026-11-22T02:30:00.000Z',
  locationText: '广东省广州市荔湾区岭南花卉市场 · 长中文地址需要自动换行显示，不截断实际记录',
};
for (const name of Object.keys(CASES)) {
  test(`实际 Sharp 渲染 ${name}：中文、尺寸和原图保留`, async () => {
    const source = await fixture(name);
    const hash = crypto.createHash('sha256').update(source.buffer).digest('hex');
    const result = await render(source.buffer, { ...context, type: source.spec.type || 'DOOR_OPEN' });
    assert.equal(crypto.createHash('sha256').update(source.buffer).digest('hex'), hash);
    assert(result.buffer.length > 0);
    assert.notEqual(crypto.createHash('sha256').update(result.buffer).digest('hex'), hash);
    const output = await sharp(result.buffer).metadata();
    assert.equal(output.width, result.output.width);
    assert.equal(output.height, result.output.height);
    assert(result.lines.some(line => line.includes('2026-11-22 10:30:00 星期日')));
    if (name === 'rotated') {
      assert.equal(result.output.width, 800);
      assert.equal(result.output.contentHeight, 1200);
    }
    if (name === 'large') {
      assert.equal(result.output.width, 2000);
      assert.equal(result.output.contentHeight, 1333);
    }
    if (name === 'waybill') {
      assert.equal(result.layout, 'footer');
      assert.equal(result.output.width, 1400);
      assert.equal(result.output.contentHeight, 1900);
      const originalPixels = await sharp(source.buffer).rotate().flatten({ background: '#ffffff' }).raw().toBuffer();
      const outputPixels = await sharp(result.buffer).extract({ left: 0, top: 0, width: 1400, height: 1900 })
        .flatten({ background: '#ffffff' }).raw().toBuffer();
      assert(outputPixels.equals(originalPixels), '运单正文RGB像素应完全保留');
    }
    await fs.mkdir(evidence, { recursive: true });
    await fs.writeFile(path.join(evidence, `${name}.${result.extension}`), result.buffer);
  });
}
test('缺字体、损坏图片、非图片、超大输入不能作为水印成功', async () => {
  const { buffer } = await fixture('small');
  await assert.rejects(render(buffer, context, { fontfile: path.join(__dirname, 'absent-font.ttc') }), /FONT_UNAVAILABLE/);
  await assert.rejects(render(Buffer.from('not an image'), context));
  await assert.rejects(render(Buffer.alloc(MAX_BYTES + 1), context), /IMAGE_BYTES_LIMIT/);
  await assert.rejects(render(await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).png().toBuffer(), context), /IMAGE_TOO_SMALL/);
});
test('缺设备时间标明服务器收到；位置与XML字符如实保留', () => {
  const lines = linesFor({ ...context, captureTime: null, receivedAt: '2026-11-22T02:30:00.000Z', locationText: 'A&B <仓库>' });
  assert(lines[1].startsWith('服务器收到：'));
  assert(lines[1].includes('拍摄时间未提供'));
  assert.equal(lines[2], '地点：A&B <仓库>');
  assert(!lines.some(line => line.includes('天气')));
});
