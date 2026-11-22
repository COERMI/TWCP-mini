const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.join(process.env.LOCALAPPDATA, 'Codex', 'transport-v1-20261122');
const evidence = path.resolve(__dirname, '../docs/evidence/2026-11-22/admin-v1');
const cliPath = path.join(process.env.APPDATA, 'npm/node_modules/@cloudbase/cli/bin/tcb');
async function cli(args, name) {
  const { stdout } = await execute(process.execPath, [cliPath, ...args, '--json'], { timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  await fs.writeFile(path.join(root, name), stdout);
  const response = JSON.parse(stdout);
  if (response.error) throw new Error(`${name}/${response.error.code}`);
  return response.data;
}
async function main() {
  const config = JSON.parse(await fs.readFile(path.join(root, 'cloudbaserc.json'), 'utf8')).functions[0].envVariables;
  const now = Date.now();
  const sign = data => {
    const body = Buffer.from(JSON.stringify(data)).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', config.ADMIN_SECRET).update(body).digest('base64url');
  };
  const token = sign({ sub: config.ADMIN_USERNAME, iat: now, exp: now + 3600000 }), checks = [];
  const check = (name, passed) => {
    checks.push({ check: name, passed: Boolean(passed) });
    console.log(`${name}: ${passed ? 'passed' : 'FAILED'}`);
    if (!passed) throw new Error(name);
  };
  let sequence = 0;
  async function raw(input) {
    const file = path.join(root, `admin-check-${++sequence}.request.private.json`);
    await fs.writeFile(file, JSON.stringify(input));
    const result = await cli(['fn', 'invoke', 'transportV1', '--cwd', root, '-d', '@' + file], `admin-check-${sequence}.result.private.json`);
    return JSON.parse(result.RetMsg);
  }
  async function call(action, input = {}) {
    const result = await raw({ ...input, action, token });
    if (!result.success) throw new Error(`${action}/${result.code}`);
    return result.data;
  }
  const env = config.V1_ENV_ID;
  try {
    const indexes = [];
    for (const table of ['transport_v1_records', 'transport_records']) {
      const body = [{ TableName: table, CommandType: 'COMMAND', Command: JSON.stringify({
        createIndexes: table, indexes: [
          { key: { created_at: -1, _id: -1 }, name: 'created_then_id_desc' },
          { key: { [table === 'transport_v1_records' ? 'phase' : 'status']: 1, created_at: -1, _id: -1 }, name: 'phase_created_then_id_desc' },
        ],
      }) }];
      await cli(['db','nosql','execute','--command',JSON.stringify(body),'-e',env], `${table}-admin-index-create.json`);
      const result = await cli(['db','nosql','execute','--command',JSON.stringify([{
        TableName: table, CommandType: 'COMMAND', Command: JSON.stringify({ listIndexes: table }),
      }]),'-e',env], `${table}-admin-indexes.json`);
      indexes.push({ collection: table, indexes: result.results.flat().map(i => ({ name: i.name, keys: Object.keys(i.key) })) });
    }
    await fs.writeFile(path.join(evidence, 'indexes.json'), JSON.stringify(indexes, null, 2));
    const list = await call('adminList', { pageSize: 2 });
    check('admin-list-new-records', list.list.length > 0 && list.total >= list.list.length);
    const second = await call('adminList', { page: 2, pageSize: 2 });
    check('admin-list-pages-do-not-overlap', second.list.every(b => list.list.every(a => a.id !== b.id)));
    check('no-admin-token-refused', (await raw({ action: 'adminList' })).code === 'FORBIDDEN');
    check('expired-admin-refused', (await raw({ action: 'adminList', token: sign({ sub: config.ADMIN_USERNAME, iat: now - 2000, exp: now - 1 }) })).code === 'FORBIDDEN');
    check('admin-without-expiry-refused', (await raw({ action: 'adminList', token: sign({ sub: config.ADMIN_USERNAME, iat: now }) })).code === 'FORBIDDEN');
    const legacy = await call('adminList', { source: 'legacy' });
    check('legacy-record-list-compatible', legacy.source === 'legacy' && Array.isArray(legacy.list));
    if (legacy.list.length) {
      const detail = await call('adminWorkflow', { source: 'legacy', record_id: legacy.list[0].id });
      check('legacy-record-detail-compatible', detail.record.source === 'legacy' && detail.record.id === legacy.list[0].id);
    }
    const synthetic = JSON.parse(await fs.readFile(path.join(root, 'workflow-automation-target.private.json'), 'utf8')).record.id;
    const events = await call('adminWorkflow', { record_id: synthetic });
    const photos = await call('adminWorkflow', { record_id: synthetic, collection: 'photos' });
    const doors = events.items.filter(e => e.kind === 'door');
    check('headquarters-sees-two-independent-door-groups', doors.length >= 2 && doors.some(e => e.ready_by_type.DOOR_OPEN === 3));
    const photo = photos.items.find(p => !p.removed_at && p.status === 'ready');
    const links = await call('adminPhotoLinks', { record_id: synthetic, photo_id: photo.id });
    check('admin-can-sign-original-and-watermark', Boolean(links.original_url && links.watermarked_url));
    const [original, watermark] = await Promise.all([links.original_url, links.watermarked_url].map(url => fetch(url)));
    check('admin-signed-images-downloadable', original.ok && watermark.ok);
    const other = list.list.find(r => r.id !== synthetic);
    check('admin-photo-cannot-cross-trip', (await raw({ action: 'adminPhotoLinks', token, record_id: other.id, photo_id: photo.id })).code === 'INVALID_PHOTO');
    check('literal-regex-search-not-executed', (await call('adminList', { keyword: '.*' })).total === 0);
    const driverTarget = JSON.parse(await fs.readFile(path.join(root, 'driver-target.private.json'), 'utf8'));
    const driver = await call('adminWorkflow', { record_id: driverTarget.record_id });
    // Only metadata is read from the user's phone-test trip. No physical photos
    // or signed links from that trip are copied into public artifacts.
    await fs.writeFile(path.join(evidence, 'phone-feedback.json'), JSON.stringify({
      at: new Date().toISOString(), userFeedback: '没有报错', source: '负责人在新版整趟二维码后反馈',
      phaseObserved: driver.record.phase, effectivePhotosObserved: driver.record.photo_count,
      pendingPhotosObserved: driver.record.pending_count, completedDoorGroupsObserved: driver.record.closed_door_count,
      baseTypesObserved: Object.keys(driver.record.base_ready).filter(t => driver.record.base_ready[t] > 0),
      limitation: '反馈登记为未出现报错；未据此推断所有机型、弱网、越权、照片清晰度矩阵通过。',
    }, null, 2));
  } finally {
    await fs.writeFile(path.join(evidence, 'cloud-checks.json'), JSON.stringify({ at: new Date().toISOString(),
      version: 'transport-v1-admin-1', checks, scope: 'Real deployed API; list, legacy compatibility and authorization. Image downloads use synthetic automation trip only.' }, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
