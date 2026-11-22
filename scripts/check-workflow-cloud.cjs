// Trusted WeChat developer-tools identity -> deployed API -> real private storage.
// Only synthetic TEST records/images. Never replaces the driver's phone-test invite.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const privateRoot = path.join(process.env.LOCALAPPDATA, 'Codex', 'transport-v1-20261122');
const evidenceRoot = path.resolve(__dirname, '../docs/evidence/2026-11-22/transport-v1-workflow');
const quote = value => `'${value.replaceAll("'", "''")}'`;
async function main() {
  const automator = require(path.join(privateRoot, 'automation-runtime/node_modules/miniprogram-automator'));
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' });
  const checks = [], at = Date.now(), run = `workflow_${at}`;
  let sequence = 0, id;
  const request = () => `${run}_${++sequence}`;
  const check = (name, condition) => {
    checks.push({ check: name, passed: Boolean(condition) });
    console.log(`${name}: ${condition ? 'passed' : 'FAILED'}`);
    if (!condition) throw new Error(`Failed: ${name}`);
  };
  const raw = async input => {
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await mini.evaluate(async data => {
          const response = await wx.cloud.callFunction({ name: 'transportV1', data, config: { timeout: 60000 } });
          return response.result;
        }, input);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        // Retry the exact action and receipt ID after transient devtools polling errors.
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    }
    await fs.writeFile(path.join(privateRoot, `${run}-last-response.private.json`), JSON.stringify(result));
    return result;
  };
  const call = async (action, payload = {}) => {
    const response = await raw({ action, record_id: id, request_id: request(), ...payload });
    if (!response.success) throw new Error(`${action}: ${response.code}`);
    return response.data;
  };
  const event = async (kind, type) => (await call('startEvent', { kind, type })).event.id;
  const nativeUpload = process.env.V1_TEST_NATIVE_UPLOAD === '1';
  const post = async (target, base64, override = {}) => {
    if (nativeUpload) return mini.evaluate(async (target, bytes, override) => {
      const filePath = wx.env.USER_DATA_PATH + '/workflow-synthetic.jpg';
      wx.getFileSystemManager().writeFileSync(filePath, bytes, 'base64');
      return new Promise(resolve => wx.uploadFile({
        url: target.url, filePath, name: 'file', formData: { ...target.form_data, ...override },
        success: resolve, fail: error => resolve({ statusCode: 0, diagnostic: error.errMsg }),
      }));
    }, target, base64, override);
    // Domain registration is a separate phone prerequisite. Backend evidence can
    // still exercise the same scoped POST policy using only synthetic bytes.
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...target.form_data, ...override })) form.set(key, value);
    form.set('file', new Blob([Buffer.from(base64, 'base64')]), 'synthetic.jpg');
    const response = await fetch(target.url, { method: 'POST', body: form, signal: AbortSignal.timeout(45000) });
    return { statusCode: response.status, data: await response.text() };
  };
  let example;
  const archive = async (event_id, type, base64) => {
    const reserved = await call('reservePhoto', { event_id, type, capture_time: at });
    const grant = await call('uploadTarget', { photo_id: reserved.photo.id });
    if (!example) {
      const forbiddenUpload = await post(grant.target, base64, { key: 'transport-v1/scope-denied/' + Date.now() + '.jpg' });
      check('signed-upload-cannot-change-object-key', forbiddenUpload.statusCode === 403);
    }
    const uploaded = await post(grant.target, base64);
    await fs.writeFile(path.join(privateRoot, 'workflow-last-upload.private.json'), JSON.stringify(uploaded));
    if (!Number.isFinite(uploaded.statusCode) || uploaded.statusCode < 200 || uploaded.statusCode >= 300) {
      const code = /<Code>([A-Za-z0-9]+)<\/Code>/.exec(String(uploaded.data));
      throw new Error(`Signed upload failed: ${uploaded.statusCode}/${code ? code[1] : 'unknown'}`);
    }
    const result = await call('processPhoto', { photo_id: reserved.photo.id, file_id: grant.target.file_id });
    if (result.photo.status !== 'ready') throw new Error(`Photo processing: ${result.photo.status}/${result.photo.error}`);
    if (!example) example = { photo_id: reserved.photo.id, file_id: grant.target.file_id, original: Buffer.from(base64, 'base64') };
    return reserved.photo.id;
  };
  try {
    const config = JSON.parse(await fs.readFile(path.join(privateRoot, 'cloudbaserc.json'), 'utf8')).functions[0].envVariables;
    const payload = Buffer.from(JSON.stringify({ sub: config.ADMIN_USERNAME, iat: at, exp: at + 3600000 })).toString('base64url');
    const token = payload + '.' + crypto.createHmac('sha256', config.ADMIN_SECRET).update(payload).digest('base64url');
    const file = path.join(privateRoot, `${run}-prepare.private.json`);
    await fs.writeFile(file, JSON.stringify({ action: 'prepare', token, request_id: request(),
      plate_number: '粤B12345', ship_date: '2026-11-22', description: 'TEST 自动联调合成运输', batch: 'TEST-WORKFLOW' }));
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command',
      `tcb.cmd fn invoke transportV1 --cwd ${quote(privateRoot)} -d ${quote('@' + file)} --json`], { maxBuffer: 1024 * 1024 });
    const prepared = JSON.parse(JSON.parse(stdout).data.RetMsg);
    if (!prepared.success) throw new Error(`prepare: ${prepared.code}`);
    id = prepared.data.record.id;
    await fs.writeFile(path.join(privateRoot, 'workflow-automation-target.private.json'), JSON.stringify(prepared.data));
    await call('claim', { invite: prepared.data.invite, confirm_plate: '粤B12345' });
    check('trusted-wechat-claim', (await call('get')).record.phase === 'preparing');
    const denied = await mini.evaluate(async () => {
      try { await wx.cloud.database().collection('transport_v1_photos').limit(1).get(); return false; }
      catch { return true; }
    });
    check('client-database-direct-read-denied', denied);
    check('base-order-enforced', (await raw({ action: 'startEvent', record_id: id, request_id: request(), kind: 'base', type: 'CARGO_PHOTO' })).code === 'BASE_ORDER');
    const { fixture } = require('../cloudfunctions/imagePipelineProbe/fixtures');
    const base64 = (await fixture('waybill')).buffer.toString('base64');
    let waybill, first;
    for (const type of ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT']) {
      const e = await event('base', type);
      const p = await archive(e, type, base64);
      if (type === 'WAYBILL') { waybill = e; first = p; }
    }
    check('three-base-types-archived', Object.values((await call('getWorkflow')).base_ready).every(n => n === 1));
    const duplicate = await call('processPhoto', { photo_id: example.photo_id, file_id: example.file_id });
    check('ready-processing-retry-idempotent', duplicate.photo.status === 'ready' && (await call('getWorkflow')).base_ready.WAYBILL === 1);
    const links = await call('photoLinks', { photo_id: example.photo_id });
    const original = Buffer.from(await (await fetch(links.original_url)).arrayBuffer());
    const derivative = Buffer.from(await (await fetch(links.watermarked_url)).arrayBuffer());
    check('original-download-exact-bytes', original.equals(example.original));
    const sharp = require('../cloudfunctions/imagePipelineProbe/node_modules/sharp');
    const meta = await sharp(derivative).metadata();
    check('waybill-derivative-is-real-footer-png', meta.format === 'png' && meta.height > (await sharp(original).metadata()).height);
    const a = await sharp(original).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(derivative).extract({ left: 0, top: 0, width: a.info.width, height: a.info.height }).removeAlpha().raw().toBuffer();
    check('waybill-content-pixels-preserved', a.data.equals(b));
    await fs.writeFile(path.join(evidenceRoot, 'workflow-synthetic-waybill.png'), derivative);
    const prefix = example.file_id.slice(0, example.file_id.indexOf('/', 8) + 1);
    const archiveKey = `transport-v1/archive/${id}/${example.photo_id}/${crypto.createHash('sha256').update(original).digest('hex')}/original`;
    const directRead = await mini.evaluate(async fileID => {
      try {
        const response = await wx.cloud.downloadFile({ fileID });
        return { denied: response.statusCode !== 200 };
      }
      catch { return { denied: true }; }
    }, prefix + archiveKey);
    check('client-direct-archive-read-denied', directRead.denied);
    const directWrite = await mini.evaluate(async cloudPath => {
      try { await wx.cloud.uploadFile({ cloudPath, filePath: wx.env.USER_DATA_PATH + '/workflow-synthetic.jpg' }); return { denied: false }; }
      catch { return { denied: true }; }
    }, archiveKey);
    check('client-direct-archive-overwrite-denied', directWrite.denied);
    await call('submitBase');
    check('last-submitted-base-protected', (await raw({ action: 'removePhoto', record_id: id, request_id: request(), photo_id: first, reason: 'TEST 替换' })).code === 'REPLACEMENT_REQUIRED');
    await archive(waybill, 'WAYBILL', base64);
    await call('removePhoto', { photo_id: first, reason: 'TEST 成功补拍后替换' });
    check('replacement-allows-removal', (await call('getWorkflow')).base_ready.WAYBILL === 1);
    const door1 = await event('door');
    check('active-door-resumes-same-group', await event('door') === door1);
    check('door-close-requires-open', (await raw({ action: 'reservePhoto', record_id: id, request_id: request(), event_id: door1, type: 'DOOR_CLOSE' })).code === 'DOOR_ORDER');
    for (let n = 0; n < 3; n++) await archive(door1, 'DOOR_OPEN', base64);
    await archive(door1, 'DOOR_CLOSE', base64);
    await call('finishDoor', { event_id: door1 });
    check('door-save-does-not-complete-trip', (await call('getWorkflow')).phase === 'transporting');
    const door2 = await event('door');
    await archive(door2, 'DOOR_OPEN', base64); await archive(door2, 'DOOR_CLOSE', base64);
    await call('finishDoor', { event_id: door2 });
    const issue = (await call('startEvent', { kind: 'issue', note: 'TEST 纯文字问题' })).event.id;
    const bad = await call('reservePhoto', { event_id: issue, type: 'ISSUE', capture_time: at });
    const badGrant = await call('uploadTarget', { photo_id: bad.photo.id });
    const uploadedBad = await post(badGrant.target, Buffer.from('TEST deliberately invalid image').toString('base64'));
    if (uploadedBad.statusCode < 200 || uploadedBad.statusCode >= 300) throw new Error('Bad fixture upload failed');
    const failed = await call('processPhoto', { photo_id: bad.photo.id, file_id: badGrant.target.file_id });
    check('failed-render-retains-original', failed.photo.status === 'watermark_failed' && failed.photo.original_bytes > 0);
    check('pending-photo-blocks-completion', (await raw({ action: 'completeTrip', record_id: id, request_id: request(), confirm_all_unloaded: true })).code === 'PHOTOS_PENDING');
    await call('removePhoto', { photo_id: bad.photo.id, reason: 'TEST 移除故意损坏的图片' });
    await call('completeTrip', { confirm_all_unloaded: true });
    check('explicit-completion-succeeds', (await call('getWorkflow')).phase === 'completed');
    await call('reopenTrip', { reason: 'TEST 验证纠正完成' });
    const state = await call('getWorkflow');
    const doors = state.items.filter(e => e.kind === 'door').sort((a, b) => a.sequence - b.sequence);
    check('two-independent-door-groups-with-three-opening-photos', doors.length === 2 && doors[0].ready_by_type.DOOR_OPEN === 3 && doors[1].ready_by_type.DOOR_OPEN === 1);
    check('correction-restores-transporting', state.phase === 'transporting');
    const page = await mini.navigateTo('/pages/trip/index?record=' + encodeURIComponent(id));
    await page.waitFor(async () => !(await page.data('busy')) && Boolean(await page.data('state')));
    check('phone-page-displays-cloud-state', (await page.data('doors')).length === 2 && (await page.data('base'))[0].ready === 1 && !(await page.data('error')));
    await mini.screenshot({ path: path.join(evidenceRoot, 'workflow-synthetic-page.png') });
    await fs.writeFile(path.join(privateRoot, 'workflow-automation-complete.private.json'), JSON.stringify({ record_id: id, at: new Date().toISOString(), checks }));
  } finally {
    await fs.mkdir(evidenceRoot, { recursive: true });
    await fs.writeFile(path.join(evidenceRoot, 'cloud-checks.json'), JSON.stringify({
      at: new Date().toISOString(), version: 'transport-v1-workflow-3', checks,
      identity: 'Trusted WeChat developer-tools context; no injected OPENID or business-auth bypass',
      uploadTransport: nativeUpload ? 'WeChat wx.uploadFile with domain validation enabled' : 'Node fetch using identical signed POST policy; phone upload domain not verified by this run',
      scope: 'Synthetic test data; does not substitute for physical camera, offline phone or second-user validation',
    }, null, 2));
    await mini.disconnect();
  }
}
const timeout = setTimeout(() => { console.error('Workflow cloud check timed out; inspect private logs'); process.exit(2); }, 600000);
main().catch(error => { console.error(error.message.replace(/cloud:\/\/\S+/g, '[private file]')); process.exitCode = 1; }).finally(() => clearTimeout(timeout));
