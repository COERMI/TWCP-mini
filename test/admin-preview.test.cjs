const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPreviewer } = require('../scripts/admin-preview.cjs');
const invitation = {record:{id:'trip_'+'a'.repeat(40)},invite:'b'.repeat(64)};
test('预览只在独立工程写本趟目标，保留域名校验和既有手机入口；同一时刻只编译一个', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'transport-admin-preview-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'driver-target.private.json'),'original target');
  let args, release;
  const gate = new Promise(resolve=>{release=resolve});
  const preview = createPreviewer({root,run:async input=>{
    args=input; await gate;
    await fs.writeFile(input[input.indexOf('--qr-output')+1],Buffer.from([137,80,78,71,13,10,26,10,0]));
    return {stdout:'private preview log',stderr:''};
  }});
  const first=preview(invitation);
  assert.equal((await preview(invitation)).success,false); release();
  const result=await first;
  assert(result.success); assert.equal(result.data.record_id,invitation.record.id); assert.equal(result.data.preview_only,true);
  const project=args[args.indexOf('--project')+1];
  assert.equal(path.basename(project),'dispatch-phone-project');
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'miniprogram/app.json'), 'utf8'));
  assert.equal(manifest.pages[0], 'pages/entry/index');
  assert(manifest.pages.includes('pages/dispatch/index'));
  assert.equal(JSON.parse(await fs.readFile(path.resolve(__dirname, '../tools/workflow-probe/miniprogram/app.json'), 'utf8')).pages[0], 'pages/dispatch/index');
  const target=await fs.readFile(path.join(project,'miniprogram/target.js'),'utf8');
  assert(target.includes(invitation.invite)); assert(!target.includes('ADMIN_SECRET'));
  assert.equal(JSON.parse(await fs.readFile(path.join(project,'project.config.json'),'utf8')).setting.urlCheck,true);
  assert.equal(await fs.readFile(path.join(root,'driver-target.private.json'),'utf8'),'original target');
});
test('预览拒绝无效邀请，CLI错误中可能含的秘密不返回浏览器', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'transport-preview-error-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let calls=0;
  const preview=createPreviewer({root,run:async()=>{calls++;throw new Error('secret=never-return');}});
  assert.equal((await preview({...invitation,invite:'bad'})).success,false); assert.equal(calls,0);
  const result=await preview(invitation); assert.equal(result.success,false); assert(!JSON.stringify(result).includes('never-return'));
});
test('按实际文件识别微信CLI生成的JPEG二维码，不依据文件后缀误拒绝图片', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'transport-preview-jpeg-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const preview=createPreviewer({root,run:async args=>{
    await fs.writeFile(args[args.indexOf('--qr-output')+1],Buffer.from([255,216,255,224,0,16,74,70,73,70]));
    return {stdout:'preview completed',stderr:''};
  }});
  const result=await preview(invitation); assert.equal(result.success,true);assert(result.data.qr.startsWith('data:image/jpeg;base64,'));
});
