// Build a self-contained, expiring cloud probe configuration outside the source tree.
// Credentials are generated locally and never printed or written to project files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.join(process.env.LOCALAPPDATA, 'Codex', 'ledgerscheduler-stage3-20261122');
fs.mkdirSync(target, { recursive: true });
const keyFile = path.join(target, 'probe-access.json');
const access = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, 'utf8')) :
  { ticket: crypto.randomBytes(32).toString('hex'), expiresAt: Date.now() + 48 * 3600000 };
fs.writeFileSync(keyFile, JSON.stringify(access, null, 2));
const source = path.join(root, 'cloudfunctions', 'imagePipelineProbe');
const staged = path.join(target, 'functions', 'imagePipelineV1Probe');
fs.cpSync(source, staged, { recursive: true, filter: value => !value.split(path.sep).includes('node_modules') });
// Cloud installation may omit optional dependencies. Make the required Linux ABI
// packages explicit only in the Linux deployment copy; keep local Windows usable.
const stagedPackage = JSON.parse(fs.readFileSync(path.join(staged, 'package.json'), 'utf8'));
stagedPackage.dependencies['@img/sharp-linux-x64'] = '0.33.5';
stagedPackage.dependencies['@img/sharp-libvips-linux-x64'] = '1.0.4';
fs.writeFileSync(path.join(staged, 'package.json'), JSON.stringify(stagedPackage, null, 2));
const config = {
  envId: 'cloud1-d3go2mtsga3f8ea74', functionRoot: path.join(target, 'functions'),
  functions: [{ name: 'imagePipelineV1Probe', handler: 'index.main', runtime: 'Nodejs20.19',
    timeout: 60, memorySize: 1024, installDependency: true,
    ignore: ['node_modules'],
    envVariables: { PROBE_KEY: access.ticket, PROBE_EXPIRES_AT: String(access.expiresAt) },
    description: 'Isolated expiring stage-3 image probe; no business writes' }],
};
fs.writeFileSync(path.join(target, 'cloudbaserc.json'), JSON.stringify(config, null, 2));
const miniTarget = path.join(target, 'phone-project');
fs.cpSync(path.join(root, 'tools', 'image-probe'), miniTarget, { recursive: true });
fs.writeFileSync(path.join(miniTarget, 'miniprogram', 'probe-access.js'),
  `module.exports = ${JSON.stringify(access)};\n`);
for (const name of ['landscape', 'portrait', 'small', 'narrow', 'panorama', 'rotated', 'waybill', 'large']) {
  fs.writeFileSync(path.join(target, `request-${name}.json`), JSON.stringify({
    ticket: access.ticket, action: 'fixture', name, requestId: `fixture_20261122_${name}`,
  }));
}
fs.writeFileSync(path.join(target, 'request-unauthorized.json'), JSON.stringify({
  ticket: '0'.repeat(64), action: 'fixture', name: 'small', requestId: 'unauthorized_20261122',
}));
console.log(`Prepared private probe workspace: ${target}`);
console.log(`Expiry: ${new Date(access.expiresAt).toISOString()}`);
