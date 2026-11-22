// Stage a test-only function outside source control. admin-config.private.json
// must first be fetched with `tcb fn detail adminLogin --json` into target.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const target = path.join(process.env.LOCALAPPDATA, 'Codex', 'transport-v1-20261122');
const root = path.resolve(__dirname, '..');
const envId = 'cloud1-d3go2mtsga3f8ea74';
const appId = 'wx2c993513e03bb60a';
const details = JSON.parse(fs.readFileSync(path.join(target, 'admin-config.private.json'), 'utf8')).data;
const existing = Object.fromEntries(details.Environment.Variables.map(v => [v.Key, v.Value]));
if (!existing.ADMIN_SECRET || !existing.ADMIN_USERNAME) throw new Error('Existing admin verifier configuration unavailable');
const keyFile = path.join(target, 'invite-secret.private.json');
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, JSON.stringify({ secret: crypto.randomBytes(32).toString('hex') }));
const inviteSecret = JSON.parse(fs.readFileSync(keyFile)).secret;
const staged = path.join(target, 'functions', 'transportV1');
fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(root, 'cloudfunctions', 'transportV1'), staged, {
  recursive: true, filter: value => !value.split(path.sep).includes('node_modules'),
});
const verifiedImage = path.join(root, 'cloudfunctions', 'imagePipelineProbe');
const image = path.join(staged, 'image');
fs.mkdirSync(image, { recursive: true });
fs.copyFileSync(path.join(verifiedImage, 'renderer.js'), path.join(image, 'renderer.js'));
fs.cpSync(path.join(verifiedImage, 'fonts'), path.join(image, 'fonts'), { recursive: true });
const verifiedModules = path.join(process.env.LOCALAPPDATA, 'Codex',
  'ledgerscheduler-stage3-20261122', 'functions', 'imagePipelineV1Probe', 'node_modules');
for (const [name, version] of [['sharp', '0.33.5'], ['wx-server-sdk', '2.6.3'], ['@cloudbase/node-sdk', '2.9.1'],
  ['@img/sharp-linux-x64', '0.33.5'], ['@img/sharp-libvips-linux-x64', '1.0.4']]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(verifiedModules, name, 'package.json'), 'utf8'));
  if (pkg.version !== version || pkg.name !== name) throw new Error('Verified image dependency mismatch');
}
fs.cpSync(verifiedModules, path.join(staged, 'node_modules'), { recursive: true });
const oldConfig = path.join(target, 'cloudbaserc.json');
const beforeWorkflow = path.join(target, 'before-workflow-cloudbaserc.private.json');
if (fs.existsSync(oldConfig) && !fs.existsSync(beforeWorkflow)) fs.copyFileSync(oldConfig, beforeWorkflow);
fs.writeFileSync(path.join(target, 'cloudbaserc.json'), JSON.stringify({
  envId, region: 'ap-shanghai', functionRoot: path.join(target, 'functions'),
  functions: [{ name: 'transportV1', handler: 'index.main', runtime: 'Nodejs20.19',
    timeout: 60, memorySize: 1024, installDependency: false, ignore: [],
    description: 'Test-only V1 trip, photo archival and door workflow API',
    envVariables: {
      V1_ENV_ID: envId, V1_APP_ID: appId, ADMIN_USERNAME: existing.ADMIN_USERNAME,
      ADMIN_SECRET: existing.ADMIN_SECRET, INVITE_SECRET: inviteSecret,
    } }],
}, null, 2));
console.log('Prepared private transportV1 workspace; no secrets printed.');
