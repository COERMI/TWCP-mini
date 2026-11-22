'use strict';
// Developer-only preview: an existing administrator authorizes one unclaimed
// trip. Invitations and CLI output stay outside the repository.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const privateRoot = path.join(process.env.LOCALAPPDATA || '', 'Codex', 'transport-v1-20261122');
const ideDirectory = 'C:/Program Files (x86)/Tencent/微信web开发者工具';
async function ide(args) {
  const entry = path.join(ideDirectory, 'resources/app.asar.unpacked/js/common/cli/index.js');
  const bootstrap = "const e=process.argv[1],a=process.argv.slice(2).filter(x=>x!=='--electron');process.argv=[process.execPath,'--ms-enable-electron-run-as-node',e,'--electron'].concat(a);require(e)";
  return execute(path.join(ideDirectory, '微信开发者工具.exe'), ['-e', bootstrap, entry, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', cwd: process.cwd() },
    windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
}
function createPreviewer({ root = privateRoot, run = ide } = {}) {
  let active = false;
  return async invitation => {
    if (active) return { success: false, message: '正在生成另一个测试二维码，请稍后重试' };
    if (!invitation || !/^[a-f0-9]{64}$/.test(invitation.invite) ||
        !/^trip_[a-f0-9]{40}$/.test(invitation.record?.id)) return { success: false, message: '本趟入口未通过核对' };
    active = true;
    try {
      // Separate project: do not overwrite the driver's previously verified
      // preview project, invitation target or QR.
      const project = path.join(root, 'dispatch-phone-project');
      await fs.mkdir(project, { recursive: true });
      await fs.cp(path.resolve(__dirname, '../tools/workflow-probe'), project, { recursive: true });
      await fs.writeFile(path.join(project, 'miniprogram/target.js'),
        `module.exports = ${JSON.stringify({ invite: invitation.invite, record_id: invitation.record.id })};\n`);
      const configPath = path.join(project, 'project.config.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      config.projectname = '运输影像-后台本趟入口测试';
      if (config.appid !== 'wx2c993513e03bb60a' || config.setting.urlCheck !== true) throw new Error('WRONG_PROJECT');
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      const output = path.join(root, 'dispatch-previews', crypto.randomBytes(12).toString('hex'));
      await fs.mkdir(path.dirname(output), { recursive: true });
      try {
        const result = await run(['preview', '--project', project, '--qr-format', 'image',
          '--qr-output', output + '.jpg', '--info-output', output + '.json', '--lang', 'zh']);
        await fs.writeFile(output + '.private.log', result.stdout + '\n' + result.stderr);
      } catch {
        // Vendor logs can contain an invitation or a session; never expose them.
        return { success: false, message: '微信测试二维码未生成。档案已保留，请确认开发者工具已登录、服务端口已开启后重试' };
      }
      const image = await fs.readFile(output + '.jpg');
      // The installed vendor CLI emits JPEG for --qr-format image, even when
      // the requested output filename has a .png suffix. Detect actual bytes.
      const mime = image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' :
        image.subarray(0, 3).equals(Buffer.from([255,216,255])) ? 'image/jpeg' : null;
      if (!mime) throw new Error('INVALID_QR');
      return { success: true, data: { record_id: invitation.record.id, qr: `data:${mime};base64,` + image.toString('base64'), preview_only: true } };
    } catch {
      return { success: false, message: '测试二维码暂未生成，档案已保留，可稍后重试' };
    } finally { active = false; }
  };
}
module.exports = { createPreviewer, ide };
