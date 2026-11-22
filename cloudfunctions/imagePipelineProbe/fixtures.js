'use strict';
const { FONT } = require('./renderer');
const CASES = {
  landscape: { width: 1600, height: 1000 },
  portrait: { width: 1000, height: 1600 },
  small: { width: 320, height: 240 },
  narrow: { width: 96, height: 640 },
  panorama: { width: 3200, height: 320 },
  rotated: { width: 1200, height: 800, orientation: 6 },
  waybill: { width: 1400, height: 1900, type: 'WAYBILL' },
  large: { width: 6000, height: 4000 },
};
async function fixture(name) {
  const spec = CASES[name];
  if (!spec) throw new Error('UNKNOWN_FIXTURE');
  const sharp = require('sharp');
  const { width, height } = spec;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#eef2e8"/>
    <rect x="4" y="4" width="${width - 8}" height="${height - 8}" fill="none" stroke="#174e3e" stroke-width="6"/>
    ${Array.from({ length: 15 }, (_, i) => `<path d="M12 ${Math.round(height * (i + 2) / 18)}H${width - 12}" stroke="#9ba997" stroke-width="2"/>`).join('')}
    <text x="20" y="${Math.max(45, height / 10)}" font-size="${Math.min(38, width / 12)}" fill="#193e30">TOP - ${name}</text>
    <text x="20" y="${height - 16}" font-size="${Math.min(32, width / 14)}" fill="#193e30">BOTTOM 1234567890</text></svg>`);
  let pipeline = sharp(svg);
  if (name === 'waybill') {
    const text = await sharp({ text: {
      text: '货物运输单 · 技术试件\n发货方：昆明鲜花基地　收货方：广州配送中心\n品名：鲜花　数量：一百二十三件\n运单号：TEST-20261122-0001\n收货确认：包装完整，数量核对。',
      font: 'WenQuanYi Micro Hei 24', fontfile: FONT, width: width - 100, rgba: true,
    } }).png().toBuffer();
    pipeline = pipeline.composite([{ input: text, left: 50, top: 220 }]);
  }
  if (spec.orientation) pipeline = pipeline.withMetadata({ orientation: spec.orientation });
  return { buffer: await pipeline.jpeg({ quality: 95 }).toBuffer(), spec };
}
module.exports = { fixture, CASES };
