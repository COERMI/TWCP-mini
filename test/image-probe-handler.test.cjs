const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ticket = 'a'.repeat(64);
const env = 'cloud1-d3go2mtsga3f8ea74';
const requestId = 'test_request_00001';
const prefix = crypto.createHash('sha256').update(ticket).digest('hex').slice(0, 24);
const fileID = `cloud://${env}.bucket/stage3-probe/${prefix}/incoming/${requestId}.jpg`;
function harness({ expired = false, renderFails = false, environment = env } = {}) {
  const writes = [], downloads = [];
  const cloud = {
    init() {}, getWXContext: () => ({ ENV: environment }),
    downloadFile: async args => { downloads.push(args); return { fileContent: Buffer.from('test image') }; },
    uploadFile: async args => { writes.push(args); return { fileID: `cloud://${env}.bucket/${args.cloudPath}` }; },
    getTempFileURL: async () => ({ fileList: [] }),
  };
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/imagePipelineProbe/index.js'), 'utf8'), {
    exports, Buffer, Date,
    process: { env: { PROBE_KEY: ticket, PROBE_EXPIRES_AT: String(Date.now() + (expired ? -1000 : 60000)) }, version: process.version, platform: process.platform },
    require(name) {
      if (name === 'node:crypto') return crypto;
      if (name === 'wx-server-sdk') return cloud;
      if (name === './fixtures') return { CASES: {} };
      if (name === './renderer') return {
        VERSION: 'test', MAX_BYTES: 1024, timestamp: value => value,
        render: async () => {
          if (renderFails) throw new Error('native renderer unavailable');
          return { buffer: Buffer.from('watermarked'), extension: 'jpg', bytes: 11 };
        },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { run: exports.main, writes, downloads };
}
const input = { ticket, requestId, action: 'process', fileID, captureTime: 1234 };
test('无授权、过期和错误环境均不得触碰存储', async () => {
  for (const options of [{}, { expired: true }, { environment: 'production' }]) {
    const h = harness(options);
    const result = await h.run(options.expired || options.environment ? input : { ...input, ticket: 'b'.repeat(64) });
    assert.equal(result.success, false);
    assert.equal(h.writes.length + h.downloads.length, 0);
  }
});
test('不能读取另一请求或另一环境的图片', async () => {
  const h = harness();
  for (const invalid of [fileID.replace(requestId, 'another_request'), fileID.replace(env, 'other-env')]) {
    assert.equal((await h.run({ ...input, fileID: invalid })).code, 'INVALID_FILE');
  }
  assert.equal(h.downloads.length, 0);
});
test('水印失败仍保留原图且不伪造成功衍生图', async () => {
  const h = harness({ renderFails: true });
  const result = await h.run(input);
  assert.equal(result.data.status, 'watermark_failed');
  assert.equal(result.data.watermarkedFileID, null);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].fileContent.toString(), 'test image');
});
test('相同照片与元数据重试复用相同路径', async () => {
  const h = harness();
  const a = await h.run(input), b = await h.run(input);
  assert.equal(a.data.status, 'ready');
  assert.equal(a.data.originalFileID, b.data.originalFileID);
  assert.equal(a.data.watermarkedFileID, b.data.watermarkedFileID);
});
