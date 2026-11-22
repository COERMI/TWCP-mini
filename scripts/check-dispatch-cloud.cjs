'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const privateRoot = path.join(process.env.LOCALAPPDATA, 'Codex', 'transport-v1-20261122');
const evidence = path.resolve(__dirname, '../docs/evidence/2026-11-22/admin-dispatch-v1');
async function main() {
  const config = JSON.parse(await fs.readFile(path.join(privateRoot, 'cloudbaserc.json'), 'utf8')).functions[0].envVariables;
  const now = Date.now(), checks = [];
  const sign = payload => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', config.ADMIN_SECRET).update(body).digest('base64url');
  };
  const token = sign({ sub: config.ADMIN_USERNAME, iat: now, exp: now + 3600000 });
  const request = { action: 'prepare', token, request_id: `dispatch_cloud_${now}`, plate_number: '粤B12345',
    ship_date: new Date(now + 8 * 3600000).toISOString().slice(0,10), description: 'TEST 总部建档与停用验证', batch: '' };
  let sequence = 0;
  async function call(input) {
    const name = `dispatch-check-${now}-${++sequence}`;
    const file = path.join(privateRoot, name + '.request.private.json');
    await fs.writeFile(file, JSON.stringify(input));
    const result = await run(process.execPath, [path.join(process.env.APPDATA, 'npm/node_modules/@cloudbase/cli/bin/tcb'),
      'fn','invoke','transportV1','--cwd',privateRoot,'-d','@'+file,'--json'],
    { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    await fs.writeFile(path.join(privateRoot, name + '.result.private.json'), result.stdout);
    const response = JSON.parse(result.stdout);
    if (response.error) throw new Error('CLOUD_INVOCATION_FAILED');
    return JSON.parse(response.data.RetMsg);
  }
  function check(name, passed) {
    checks.push({ check: name, passed: Boolean(passed) });
    console.log(`${name}: ${passed ? 'passed' : 'FAILED'}`);
    if (!passed) throw new Error(name);
  }
  try {
    const created = await call(request);
    check('admin-creates-independent-trip',created.success && created.data.record.phase === 'awaiting_plate');
    const id = created.data.record.id, invitation = created.data.invite;
    check('create-retry-returns-same-trip-and-entry', (await call(request)).data?.record.id === id &&
      (await call({action:'adminInvite',record_id:id,token})).data?.invite === invitation);
    check('modified-retry-refused',(await call({...request,description:'TEST 修改内容'})).code === 'REQUEST_CONFLICT');
    check('no-token-cannot-recover-entry',(await call({action:'adminInvite',record_id:id})).code === 'FORBIDDEN');
    check('expired-admin-cannot-recover-entry',(await call({action:'adminInvite',record_id:id,
      token:sign({sub:config.ADMIN_USERNAME,iat:now-2000,exp:now-1})})).code === 'FORBIDDEN');
    const target = JSON.parse(await fs.readFile(path.join(privateRoot,'driver-target.private.json'),'utf8'));
    check('claimed-phone-trip-not-reissued',(await call({action:'adminInvite',record_id:target.record_id,token})).code === 'ALREADY_CLAIMED');
    check('unused-entry-can-be-revoked',(await call({action:'revoke',invite:invitation,token})).data?.revoked === true);
    check('revoked-entry-not-reissued',(await call({action:'adminInvite',record_id:id,token})).code === 'INVITE_UNAVAILABLE');
    const list = await call({action:'adminList',token,keyword:created.data.record.record_no});
    check('revoked-entry-visible-in-admin-list',Boolean(list.data?.list[0]?.invite_revoked_at));
    const detail = await call({action:'adminWorkflow',token,record_id:id});
    check('revoked-trip-retained-for-review',detail.data?.record.id === id && Boolean(detail.data.record.invite_revoked_at));
  } finally {
    await fs.writeFile(path.join(evidence,'cloud-checks.json'),JSON.stringify({
      at:new Date().toISOString(),checks,scope:'Real dedicated test cloud. Creates one TEST trip and revokes its unused invitation. Existing phone-test trip is only read.',
    },null,2));
  }
}
main().catch(()=>{console.error('Dispatch cloud check failed; private responses retained outside source.');process.exitCode=1});
