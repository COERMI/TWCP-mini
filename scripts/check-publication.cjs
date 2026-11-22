'use strict';
// Read-only pre-publication check. Never log a matching credential value.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const execute = args => execFileSync('git', args, { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
function parseEnv(text) {
  const result = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/);
    if (!match || !/(SECRET|PASSWORD|TOKEN|PRIVATE_KEY|API_KEY|MAP_KEY|PROBE_KEY)/i.test(match[1])) continue;
    let value = match[2].replace(/^(['"])(.*)\1$/, '$2').trim();
    if (value.length >= 8 && !/^(your[_-]|replace[_-]|placeholder|example|changeme|test-only)/i.test(value)) result.push(value);
  }
  return result;
}
function localSecrets() {
  const values = [];
  const env = path.join(root, '.env.local');
  if (fs.existsSync(env)) values.push(...parseEnv(fs.readFileSync(env, 'utf8')));
  const privateRoot = path.join(process.env.LOCALAPPDATA || '', 'Codex', 'transport-v1-20261122');
  const config = path.join(privateRoot, 'cloudbaserc.json');
  if (fs.existsSync(config)) {
    const data = JSON.parse(fs.readFileSync(config, 'utf8'));
    for (const fn of data.functions || []) for (const [key, value] of Object.entries(fn.envVariables || {})) {
      if (/(SECRET|PASSWORD|TOKEN|PRIVATE_KEY|API_KEY)/i.test(key) && typeof value === 'string' && value.length >= 8) values.push(value);
    }
  }
  // Known invitation targets must never appear in source or public reports.
  for (const name of ['driver-target.private.json','workflow-automation-target.private.json']) {
    const file = path.join(privateRoot, name);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof data.invite === 'string') values.push(data.invite);
    }
  }
  return [...new Set(values)];
}
const patterns = [
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['Tencent access key', /\bAKID[A-Za-z0-9]{20,}\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\s|\\[rn])*[A-Za-z0-9+/=]{32,}/g],
  ['platform session URL', /mp\.weixin\.qq\.com\/[^\s"'<>]*[?&]token=\d+/g],
  ['signed object URL', /https?:\/\/[^\s"'<>]+[?&](?:q-signature|X-Amz-Signature|sign)=[A-Za-z0-9%]+/gi],
  ['literal invitation', /(?:\binvite\b|\bticket\b)["']?\s*[:=]\s*["'][a-f0-9]{64}["']/gi],
];
function checkFile(file, buffer, secrets) {
  const findings = [];
  const normalized = file.replaceAll('\\','/');
  const ignoredFile = /(^|\/)(?:node_modules|dist|\.git|\.codebuddy)\//.test(normalized) ||
    /(^|\/)\.env(?:\.|$)/.test(normalized) && !normalized.endsWith('/.env.example') && normalized !== '.env.example' ||
    /(?:\.private\.|project\.private\.config\.json$|\/target\.js$|\/probe-access\.js$)/.test(normalized) ||
    /^docs\/evidence\/.*\.(?:png|jpe?g|webp|mp4)$/i.test(normalized);
  if (ignoredFile) findings.push({ file, kind: 'private or generated file must not be published' });
  if (buffer.includes(0)) return findings;
  const text = buffer.toString('utf8');
  for (const secret of secrets) {
    const at = text.indexOf(secret);
    if (at !== -1) findings.push({ file, kind: 'matches a real local secret or invitation', line: text.slice(0,at).split('\n').length });
  }
  for (const [kind, pattern] of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    for (const match of text.matchAll(regex)) findings.push({ file, kind, line: text.slice(0,match.index).split('\n').length });
  }
  return findings;
}
function main() {
  const staged = process.argv.includes('--staged');
  const files = execute(staged ? ['diff','--cached','--name-only','--diff-filter=ACMR','-z'] : ['ls-files','-z'])
    .toString('utf8').split('\0').filter(Boolean);
  if (!files.length) { console.error('没有待检查的文件；请先暂存本次改动。'); process.exitCode = 1; return; }
  const secrets = localSecrets(), findings = [];
  for (const file of files) {
    const bytes = staged ? execute(['show', ':' + file]) : fs.readFileSync(path.join(root,file));
    findings.push(...checkFile(file, bytes, secrets));
  }
  if (findings.length) {
    console.error('发现需要处理的上传内容；仅显示位置，不显示匹配值：');
    for (const item of findings) console.error(`${item.file}${item.line ? ':'+item.line : ''} — ${item.kind}`);
    process.exitCode = 1;
  } else console.log(`通过：检查${files.length}个${staged ? '暂存' : '已跟踪'}文件，未发现所检查的敏感文件、凭据格式或真实本机密钥值。`);
}
if (require.main === module) {
  try { main(); } catch { console.error('上传检查未完成；未输出配置或凭据。请核对Git和本机配置。'); process.exitCode = 1; }
}
module.exports = { checkFile, parseEnv };
