// Run after prepare-stage3-probe.cjs, local npm install, and npm pack of
// @img/sharp-linux-x64@0.33.5 and @img/sharp-libvips-linux-x64@1.0.4 into target.
// Ship exact native dependencies rather than relying on cloud optional installs.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const target = path.join(process.env.LOCALAPPDATA, 'Codex', 'ledgerscheduler-stage3-20261122');
const staged = path.join(target, 'functions', 'imagePipelineV1Probe');
const localModules = path.resolve(__dirname, '../cloudfunctions/imagePipelineProbe/node_modules');
require(path.join(localModules, 'sharp'));
const packages = [
  ['sharp-linux-x64', '0.33.5'],
  ['sharp-libvips-linux-x64', '1.0.4'],
];
for (const [name, version] of packages) {
  if (!fs.existsSync(path.join(target, `img-${name}-${version}.tgz`))) throw new Error(`Missing ${name} archive`);
}
fs.cpSync(localModules, path.join(staged, 'node_modules'), { recursive: true });
for (const [name, version] of packages) {
  const destination = path.join(staged, 'node_modules', '@img', name);
  fs.mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xzf', path.join(target, `img-${name}-${version}.tgz`), '-C', destination, '--strip-components=1']);
  const pkg = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
  if (pkg.version !== version || pkg.name !== `@img/${name}`) throw new Error('Native package mismatch');
}
const configFile = path.join(target, 'cloudbaserc.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
config.functions[0].installDependency = false;
config.functions[0].ignore = [];
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
console.log('Private deployment includes local dependencies plus pinned Linux x64 native packages.');
