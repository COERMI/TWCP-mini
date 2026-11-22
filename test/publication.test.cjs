const test = require('node:test');
const assert = require('node:assert/strict');
const { checkFile, parseEnv } = require('../scripts/check-publication.cjs');
test('上传检查拒绝私人配置和实拍证据文件，正常源码及环境参数可发布', () => {
  for (const file of ['.env.local','project.private.config.json','tools/phone/target.js','docs/evidence/test/photo.jpg']) {
    assert(checkFile(file,Buffer.from('{}'),[]).length > 0);
  }
  assert.equal(checkFile('admin/public/config.js',Buffer.from("envId: 'cloud1-test'"),[]).length,0);
  assert.equal(checkFile('.env.example',Buffer.from('ADMIN_SECRET=<fill-locally>'),[]).length,0);
});
test('上传检查识别真实密钥及实际私钥内容，但不误拒绝处理PEM标记的源码', () => {
  const secret = 'local-secret-for-test';
  const found = checkFile('docs/example.md',Buffer.from('Example: '+secret),[secret]);
  assert.equal(found[0].line,1); assert(!JSON.stringify(found).includes(secret));
  const marker = '-----BEGIN '+'PRIVATE KEY-----';
  assert.equal(checkFile('source.js',Buffer.from("return '"+marker+"\\n' + body"),[]).length,0);
  assert(checkFile('source.js',Buffer.from(marker+'\n'+'A'.repeat(64)),[]).some(f=>f.kind==='private key'));
  assert(checkFile('docs/example.md',Buffer.from('gh'+'p_'+'a'.repeat(36)),[]).some(f=>f.kind==='GitHub credential'));
});
test('只从dotenv中读取非占位的秘密值，普通公开连接参数不当作凭据', () => {
  const values=parseEnv('CLOUD_ENV_ID=cloud1-test\nADMIN_SECRET="actual-local-value"\nADMIN_PASSWORD=replace_this\nMAP_KEY=test-only-key\n');
  assert.deepEqual(values,['actual-local-value']);
});
