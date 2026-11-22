// Cloud smoke test for the invitation API. Never print tokens, invitations,
// environment-variable values, raw SDK errors, or full function responses.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.join(process.env.LOCALAPPDATA, 'Codex', 'transport-v1-20261122');
const evidence = path.resolve(__dirname, '../docs/evidence/2026-11-22/transport-v1');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const assert = (condition, label) => { if (!condition) throw new Error(label); };
async function invoke(name, input) {
  const request = path.join(root, `${name}.request.private.json`);
  await fs.writeFile(request, JSON.stringify(input));
  const command = `tcb.cmd fn invoke transportV1 --cwd ${quote(root)} -d ${quote('@' + request)} --json`;
  let stdout;
  try { ({ stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', command], { maxBuffer: 1024 * 1024 })); }
  catch { throw new Error(`CLI invocation failed: ${name}; inspect private logs`); }
  await fs.writeFile(path.join(root, `${name}.result.private.json`), stdout);
  return JSON.parse(JSON.parse(stdout).data.RetMsg);
}
async function main() {
  const config = JSON.parse(await fs.readFile(path.join(root, 'cloudbaserc.json'), 'utf8')).functions[0].envVariables;
  const now = Date.now();
  const sign = payload => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', config.ADMIN_SECRET).update(body).digest('base64url');
  };
  const token = sign({ sub: config.ADMIN_USERNAME, iat: now, exp: now + 3600000 });
  const runId = `cloud_v1_${now}_${crypto.randomBytes(4).toString('hex')}`;
  const base = {
    action: 'prepare', token, request_id: `${runId}_a`,
    plate_number: '粤B12345', ship_date: '2026-11-22',
    description: 'TEST 合成运输 · 入口接口验证', batch: 'TEST-20261122',
  };
  const checks = [];
  const check = (label, ok) => { assert(ok, label); checks.push({ check: label, passed: true }); console.log(`${label}: passed`); };
  const a = await invoke('prepare-a', base);
  assert(a.success, `prepare-a failed: ${a.code || 'unknown'}`);
  const repeated = await Promise.all([0, 1, 2].map(n => invoke(`repeat-${n}`, base)));
  check('same-request-reuses-record-and-invite', repeated.every(r => r.success && r.data.record.id === a.data.record.id && r.data.invite === a.data.invite));
  const [b, c] = await Promise.all(['b', 'c'].map(name => invoke(`prepare-${name}`, { ...base, request_id: `${runId}_${name}` })));
  check('same-plate-separate-trips-and-numbers', [b, c].every(r => r.success) &&
    new Set([a, b, c].map(r => r.data.record.id)).size === 3 &&
    new Set([a, b, c].map(r => r.data.record.record_no)).size === 3);
  const conflict = await invoke('conflicting-retry', { ...base, description: 'different destination' });
  check('changed-retry-rejected', conflict.code === 'REQUEST_CONFLICT');
  const noAuth = await invoke('no-admin', { ...base, token: '' });
  check('no-admin-token-rejected', noAuth.code === 'FORBIDDEN');
  const noExpiry = await invoke('no-expiry', { ...base, token: sign({ sub: config.ADMIN_USERNAME, iat: now }) });
  check('signed-token-without-expiry-rejected', noExpiry.code === 'FORBIDDEN');
  const expired = await invoke('expired-admin', { ...base, token: sign({ sub: config.ADMIN_USERNAME, iat: now - 2000, exp: now - 1000 }) });
  check('expired-admin-rejected', expired.code === 'FORBIDDEN');
  const forgedIdentity = await invoke('forged-driver', {
    action: 'claim', invite: a.data.invite, request_id: 'forged_driver_20261122',
    confirm_plate: '粤B12345', OPENID: 'pretend-driver', APPID: config.V1_APP_ID,
  });
  check('event-identity-does-not-grant-driver-access', forgedIdentity.code === 'IDENTITY_REQUIRED');
  const viewed = await invoke('admin-view', { action: 'adminGet', token, record_id: a.data.record.id });
  check('admin-can-read-unclaimed-trip-without-owner-leak', viewed.success && !viewed.data.claimed &&
    !JSON.stringify(viewed.data).includes('owner_openid') && !JSON.stringify(viewed.data).includes('invite_salt'));
  const revoke = await invoke('revoke-c', { action: 'revoke', token, invite: c.data.invite });
  const revokeAgain = await invoke('revoke-c-again', { action: 'revoke', token, invite: c.data.invite });
  check('revoke-unclaimed-invitation-is-idempotent', revoke.success && revokeAgain.success);
  const replay = await invoke('revoked-retry', { ...base, request_id: `${runId}_c` });
  check('revoked-invitation-not-reissued-by-create-retry', replay.code === 'INVITE_UNAVAILABLE');
  // Preserve a concrete driver test target only in the private workspace.
  await fs.writeFile(path.join(root, 'driver-target.private.json'), JSON.stringify({
    invite: a.data.invite, record_id: a.data.record.id, record_no: a.data.record.record_no,
  }));
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, 'cloud-checks.json'), JSON.stringify({
    at: new Date().toISOString(), version: a.version, checks,
    note: 'Driver identity/claim races are local simulated tests; actual phone binding still required.',
  }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
