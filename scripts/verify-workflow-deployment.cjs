const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '..');
const privateRoot = path.join(process.env.LOCALAPPDATA, 'Codex', 'transport-v1-20261122');
const evidenceRoot = path.resolve(root, process.argv[2] || 'docs/evidence/2026-11-22/transport-v1-workflow');
const env = 'cloud1-d3go2mtsga3f8ea74';
async function cli(args, name) {
  const { stdout } = await execute(process.execPath,
    [path.join(process.env.APPDATA, 'npm/node_modules/@cloudbase/cli/bin/tcb'), ...args, '--json'],
    { maxBuffer: 4 * 1024 * 1024 });
  await fs.writeFile(path.join(privateRoot, name), stdout);
  const result = JSON.parse(stdout);
  if (result.error) throw new Error(`Verification failed: ${name}/${result.error.code}`);
  return result.data;
}
async function main() {
  const database = await Promise.all(['transport_v1_events', 'transport_v1_photos'].map(async table => {
    // Verification only reads indexes. Provisioning belongs to its own batch;
    // re-creating an existing index can fail on a healthy deployment.
    const indexes = await cli(['db', 'nosql', 'execute', '--command', JSON.stringify([{
      TableName: table, CommandType: 'COMMAND', Command: JSON.stringify({ listIndexes: table }),
    }]), '-e', env], `${table}-indexes.json`);
    const rows = indexes.results.flat();
    const index = rows.find(i => i.name === 'record_id_then_id');
    if (!index || Object.keys(index.key).join(',') !== 'record_id,_id') throw new Error('Index field order mismatch');
    const acl = await cli(['api', 'tcb', 'DescribeDatabaseACL', '--api-version', '2018-06-08', '-e', env,
      '--body', JSON.stringify({ EnvId: env, CollectionName: table })], `${table}-acl.json`);
    if (acl.AclTag !== 'ADMINONLY') throw new Error('Database ACL mismatch');
    return { collection: table, acl: acl.AclTag, indexes: rows.map(i => ({ name: i.name, keys: Object.keys(i.key) })) };
  }));
  const storage = await cli(['storage', 'rules', 'get', '-e', env], 'storage-rules-after-workflow.json');
  if (storage.acl !== 'ADMINONLY') throw new Error('Storage must remain ADMINONLY with signed uploads');
  const detail = await cli(['fn', 'detail', 'transportV1', '-e', env], 'workflow-detail.private.json');
  if (detail.Status !== 'Active' || detail.MemorySize !== 1024 || detail.Timeout !== 60) throw new Error('Function configuration mismatch');
  const destination = path.join(privateRoot, process.argv[3] || 'workflow-deployed-final');
  await cli(['fn', 'code', 'download', 'transportV1', destination, '--cwd', privateRoot], 'workflow-final-download.private.json');
  const names = (await fs.readdir(path.join(root, 'cloudfunctions/transportV1'))).filter(n => n.endsWith('.js') || n === 'package.json');
  const sources = names.map(name => [name, path.join(root, 'cloudfunctions/transportV1', name)]);
  sources.push(['image/renderer.js', path.join(root, 'cloudfunctions/imagePipelineProbe/renderer.js')],
    ['image/fonts/wqy-microhei.ttc', path.join(root, 'cloudfunctions/imagePipelineProbe/fonts/wqy-microhei.ttc')]);
  const files = [];
  for (const [file, source] of sources) {
    const local = await fs.readFile(source), deployed = await fs.readFile(path.join(destination, file));
    if (!local.equals(deployed)) throw new Error(`Deployed source differs: ${file}`);
    files.push({ file, sha256: crypto.createHash('sha256').update(local).digest('hex'), matched: true });
  }
  await fs.writeFile(path.join(evidenceRoot, 'deployment.json'), JSON.stringify({
    at: new Date().toISOString(), version: require('../cloudfunctions/transportV1/service').VERSION,
    function: { name: 'transportV1', status: detail.Status, runtime: detail.Runtime, memoryMB: detail.MemorySize, timeoutSeconds: detail.Timeout },
    database, storage: { acl: storage.acl }, files,
    note: 'Temporary credentials, invitations and full function responses are kept outside source tree.',
  }, null, 2));
  console.log(`Verified ${files.length} deployed files, two indexed ADMINONLY collections and ADMINONLY storage.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
