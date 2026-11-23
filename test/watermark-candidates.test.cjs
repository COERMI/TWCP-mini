const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('../cloudfunctions/imagePipelineProbe/node_modules/sharp');
const { fixture } = require('../cloudfunctions/imagePipelineProbe/fixtures');
const { renderStyled } = require('../cloudfunctions/imagePipelineProbe/styled-watermark');
const context = { plate: '津CJ0836', type: 'WAYBILL', captureTime: '2026-11-23T11:37:00Z',
  recordNo: 'TEST-DEMO', photoNo: 'DEMO-1', eventName: '货运单' };
test('两种候选样式确实不同，页脚版运单正文逐像素保留', async () => {
  const { buffer } = await fixture('waybill');
  const overlay = await renderStyled(buffer, context, { style: 'overlay' });
  const footer = await renderStyled(buffer, context, { style: 'footer' });
  assert.equal(overlay.layout, 'overlay');
  assert.equal(footer.layout, 'footer');
  assert.equal(overlay.output.height, overlay.output.contentHeight);
  assert(footer.output.height > footer.output.contentHeight);
  const original = await sharp(buffer).rotate().flatten({ background: 'white' }).raw().toBuffer();
  const content = await sharp(footer.buffer).extract({ left: 0, top: 0,
    width: footer.output.width, height: footer.output.contentHeight }).flatten({ background: 'white' }).raw().toBuffer();
  assert(original.equals(content));
  assert(footer.lines.includes('19:37'));
  assert(footer.lines.includes('天气未获取'));
  assert(footer.lines.includes('温度未获取'));
  assert(footer.lines.some(line => line.includes('地点未获取')));
});
test('候选样式明确演示数据，错误输入不生成成功图', async () => {
  const { buffer } = await fixture('small');
  const result = await renderStyled(buffer, { ...context, sample: true, temperatureC: 21, weatherText: '晴（演示）' }, { style: 'footer' });
  assert(result.lines.includes('21°C'));
  assert(result.lines.some(line => line.includes('演示数据')));
  await assert.rejects(renderStyled(buffer, context, { style: 'unknown' }), /INVALID_WATERMARK_STYLE/);
  await assert.rejects(renderStyled(Buffer.from('invalid'), context, { style: 'footer' }));
});
