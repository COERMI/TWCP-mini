const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const root = path.join(process.env.LOCALAPPDATA, 'Codex', 'transport-v1-20261122');
const quote = value => `'${value.replaceAll("'", "''")}'`;
async function main() {
  const target = JSON.parse(await fs.readFile(path.join(root, 'workflow-automation-target.private.json')));
  const command = JSON.stringify([{ TableName: 'transport_v1_photos', CommandType: 'QUERY',
    Command: JSON.stringify({ find: 'transport_v1_photos', filter: { record_id: target.record.id }, limit: 1 }) }]);
  const { stdout } = await run(process.execPath, [path.join(process.env.APPDATA, 'npm/node_modules/@cloudbase/cli/bin/tcb'),
    'db', 'nosql', 'execute', '--command', command, '-e', 'cloud1-d3go2mtsga3f8ea74', '--json']);
  await fs.writeFile(path.join(root, 'archive-record.private.json'), stdout);
  const photo = JSON.parse(stdout).data.results.flat()[0];
  const automator = require(path.join(root, 'automation-runtime/node_modules/miniprogram-automator'));
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' });
  try {
    const direct = await mini.evaluate(async fileID => {
      const results = {};
      let originalPath;
      try {
        const response = await wx.cloud.downloadFile({ fileID });
        originalPath = response.tempFilePath;
        results.download = { status: response.statusCode, keys: Object.keys(response) };
        if (response.tempFilePath) {
          const buffer = wx.getFileSystemManager().readFileSync(response.tempFilePath);
          results.download.bytes = buffer.byteLength;
          results.download.magic = Array.from(new Uint8Array(buffer).slice(0, 4));
        }
      } catch (error) { results.download = { errorCode: error.errCode || null, failed: true }; }
      try {
        const response = await wx.cloud.getTempFileURL({ fileList: [fileID] });
        results.tempURL = response.fileList.map(f => ({ status: f.status, hasURL: Boolean(f.tempFileURL) }));
      } catch (error) { results.tempURL = { errorCode: error.errCode || null, failed: true }; }
      // Only this synthetic fixture is tested; upload exactly the bytes just read.
      if (originalPath) {
        try {
          const response = await wx.cloud.uploadFile({
            cloudPath: fileID.slice(fileID.indexOf('/', 8) + 1), filePath: originalPath,
          });
          results.overwrite = { succeeded: Boolean(response.fileID), status: response.statusCode };
        } catch (error) { results.overwrite = { failed: true, errorCode: error.errCode || null }; }
      }
      return results;
    }, photo.original_file_id);
    console.log(JSON.stringify({ archiveIdentity: photo.archive_identity, direct }, null, 2));
    await fs.writeFile(path.join(root, 'archive-client-diagnostic.json'), JSON.stringify(direct, null, 2));
  } finally { await mini.disconnect(); }
}
const timer = setTimeout(() => process.exit(2), 120000);
main().catch(() => { console.error('Storage diagnostic failed; inspect private response'); process.exitCode = 1; }).finally(() => clearTimeout(timer));
