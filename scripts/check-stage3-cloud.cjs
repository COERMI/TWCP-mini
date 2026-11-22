// Invoke synthetic fixtures; keep file IDs, tickets and signed URLs outside repo.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const privateRoot = path.join(process.env.LOCALAPPDATA, 'Codex', 'ledgerscheduler-stage3-20261122');
const evidence = path.resolve(__dirname, '../docs/evidence/2026-11-22/watermark-cloud');
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
async function invoke(name) {
  // Powershell argument binding avoids interpolating private request contents.
  const request = path.join(privateRoot, `request-${name}.json`);
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const command = `tcb.cmd fn invoke imagePipelineV1Probe --cwd ${quote(privateRoot)} -d ${quote('@' + request)} --json`;
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', command], { maxBuffer: 1024 * 1024 });
  await fs.writeFile(path.join(privateRoot, `result-${name}.json`), stdout);
  return JSON.parse(JSON.parse(stdout).data.RetMsg);
}
async function main() {
  await fs.mkdir(evidence, { recursive: true });
  const rows = [];
  for (const name of ['small', 'landscape', 'portrait', 'narrow', 'panorama', 'rotated', 'waybill', 'large']) {
    const response = await invoke(name);
    const d = response.data;
    if (!response.success || d?.status !== 'ready') throw new Error(`${name}: ${response.code || d?.error || 'not ready'}`);
    for (const kind of ['original', 'watermarked']) {
      const url = d[`${kind}Url`];
      if (!url || new URL(url).protocol !== 'https:') throw new Error('Missing HTTPS download URL');
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Download HTTP ${r.status}`);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (hash(bytes) !== d[`${kind}Sha256`]) throw new Error('Downloaded hash mismatch');
      await fs.writeFile(path.join(evidence, `${name}-${kind}.${name === 'waybill' && kind === 'watermarked' ? 'png' : 'jpg'}`), bytes);
    }
    rows.push({ name, status: d.status, runtime: d.runtime, layout: d.layout, original: d.original,
      output: d.output, originalBytes: d.originalBytes, outputBytes: d.outputBytes, elapsedMs: d.elapsedMs });
    await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(rows, null, 2));
    console.log(`${name}: ready, ${d.runtime}, ${d.layout}, ${d.outputBytes} bytes`);
  }
  const first = JSON.parse(JSON.parse(await fs.readFile(path.join(privateRoot, 'result-small.json'), 'utf8')).data.RetMsg);
  const retry = await invoke('small');
  if (first.data.originalFileID !== retry.data.originalFileID || first.data.watermarkedFileID !== retry.data.watermarkedFileID) {
    throw new Error('Retry changed file IDs');
  }
  const rejected = await invoke('unauthorized');
  if (rejected.code !== 'FORBIDDEN') throw new Error('Unauthorized request not rejected');
  await fs.writeFile(path.join(evidence, 'checks.json'), JSON.stringify({ sameRequestSameFiles: true, unauthorizedRejected: true }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
