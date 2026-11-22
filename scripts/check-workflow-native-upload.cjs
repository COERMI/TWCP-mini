// After registering the upload domain, verify wx.uploadFile with domain checking
// enabled on an existing synthetic automation trip. Never uses the phone invite.
const fs = require('node:fs/promises');
const path = require('node:path');
const privateRoot = path.join(process.env.LOCALAPPDATA, 'Codex', 'transport-v1-20261122');
const evidenceRoot = path.resolve(__dirname, '../docs/evidence/2026-11-22/transport-v1-workflow');
async function main() {
  const target = JSON.parse(await fs.readFile(path.join(privateRoot, 'workflow-automation-target.private.json'), 'utf8'));
  const project = JSON.parse(await fs.readFile(path.join(privateRoot, 'workflow-phone-project/project.config.json'), 'utf8'));
  if (project.setting.urlCheck !== true) throw new Error('Domain checking must remain enabled');
  const automator = require(path.join(privateRoot, 'automation-runtime/node_modules/miniprogram-automator'));
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' });
  const checks = [], runId = `native_${Date.now()}`, record_id = target.record.id;
  let sequence = 0;
  const check = (name, passed) => {
    checks.push({ check: name, passed: Boolean(passed) });
    console.log(`${name}: ${passed ? 'passed' : 'FAILED'}`);
    if (!passed) throw new Error(name);
  };
  async function call(action, payload = {}) {
    const input = { action, record_id, request_id: `${runId}_${++sequence}`, ...payload };
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await mini.evaluate(async data => (await wx.cloud.callFunction({
          name: 'transportV1', data, config: { timeout: 60000 },
        })).result, input);
      } catch (error) { if (attempt === 2) throw error; continue; }
      if (!response.success) throw new Error(`${action}/${response.code}`);
      return response.data;
    }
  }
  try {
    check('project-domain-validation-enabled', project.setting.urlCheck);
    const event = (await call('startEvent', { kind: 'issue', note: 'TEST 微信原生上传域名验证' })).event;
    const reserved = await call('reservePhoto', { event_id: event.id, type: 'ISSUE', capture_time: Date.now() });
    const grant = await call('uploadTarget', { photo_id: reserved.photo.id });
    const image = (await require('../cloudfunctions/imagePipelineProbe/fixtures').fixture('landscape')).buffer;
    const uploaded = await mini.evaluate(async (target, base64) => {
      const filePath = wx.env.USER_DATA_PATH + '/native-upload-synthetic.jpg';
      wx.getFileSystemManager().writeFileSync(filePath, base64, 'base64');
      return new Promise(resolve => wx.uploadFile({
        url: target.url, filePath, name: 'file', formData: target.form_data,
        success: result => resolve({ statusCode: result.statusCode }),
        fail: error => resolve({ statusCode: 0, domainDenied: String(error.errMsg).includes('domain list') }),
      }));
    }, grant.target, image.toString('base64'));
    check('wechat-native-upload-domain-accepted', uploaded.statusCode >= 200 && uploaded.statusCode < 300);
    const processed = await call('processPhoto', { photo_id: reserved.photo.id, file_id: grant.target.file_id });
    check('native-upload-photo-archived-with-watermark', processed.photo.status === 'ready');
    const links = await call('photoLinks', { photo_id: reserved.photo.id });
    const downloaded = Buffer.from(await (await fetch(links.original_url)).arrayBuffer());
    check('native-upload-original-bytes-preserved', downloaded.equals(image));
    const repeated = await call('processPhoto', { photo_id: reserved.photo.id, file_id: grant.target.file_id });
    check('native-upload-processing-retry-same-photo', repeated.photo.id === processed.photo.id && repeated.photo.status === 'ready');
    const page = await mini.navigateTo('/pages/trip/index?record=' + encodeURIComponent(record_id));
    await page.waitFor(async () => !(await page.data('busy')) && Boolean(await page.data('state')));
    check('native-upload-visible-in-trip-page', (await page.data('issues')).some(item =>
      item.id === event.id && item.photos.some(p => p.id === processed.photo.id && p.status === 'ready')));
  } finally {
    await fs.writeFile(path.join(evidenceRoot, 'native-upload-checks.json'), JSON.stringify({
      at: new Date().toISOString(), checks, domainValidationEnabled: true,
      scope: 'Real wx.uploadFile in WeChat developer tools with synthetic image; physical camera and phone tests remain separate.',
    }, null, 2));
    await mini.disconnect();
  }
}
const timer = setTimeout(() => { console.error('Native upload verification timed out'); process.exit(2); }, 180000);
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => clearTimeout(timer));
