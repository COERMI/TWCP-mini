'use strict';
// Synthetic samples only: no user photos, live weather, signed URLs or invitation tokens.
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture } = require('../cloudfunctions/imagePipelineProbe/fixtures');
const { renderStyled } = require('../cloudfunctions/imagePipelineProbe/styled-watermark');
async function main() {
  const out = path.resolve(__dirname, '../docs/evidence/2026-11-23/watermark-candidates');
  await fs.mkdir(out, { recursive: true });
  const samples = [];
  for (const kind of ['landscape', 'portrait', 'waybill']) {
    const source = await fixture(kind);
    for (const style of ['overlay', 'footer']) {
      const result = await renderStyled(source.buffer, {
        type: kind === 'waybill' ? 'WAYBILL' : 'DOOR_OPEN', plate: '津CJ0836',
        captureTime: '2026-11-23T11:37:00Z', eventName: kind === 'waybill' ? '货运单' : '第1次开门',
        locationText: '演示城市 · 演示仓库（非实地定位）', weatherText: '晴（演示）',
        temperatureC: 21, recordNo: 'TEST-DEMO-0001', photoNo: `DEMO-${kind}`, sample: true,
      }, { style });
      const name = `${kind}-${style}.png`;
      await fs.writeFile(path.join(out, name), result.buffer);
      samples.push({ name, requestedStyle: style, actualLayout: result.layout, ...result.output, bytes: result.bytes });
    }
  }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ synthetic: true, samples }, null, 2) + '\n');
  console.log('Created six synthetic watermark samples. No cloud writes.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
