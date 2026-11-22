const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPolicy } = require('../cloudfunctions/transportV1/upload-policy');
const environment = 'cloud1-d3go2mtsga3f8ea74';
const cloudPath = 'transport-v1/incoming/test/photo/nonce.jpg';
const metadata = { url: 'https://test-bucket.cos.ap-shanghai.myqcloud.com',
  fileId: `cloud://${environment}.test-bucket/${cloudPath}`, cosFileId: 'synthetic-metadata',
  authorization: 'never-return-the-generic-authorization' };
test('上传策略同时绑定对象、私有ACL、元数据、大小和期限；不返回密钥或通用授权', () => {
  const now = 1795334400000, credentials = { secretId: 'test-id', secretKey: 'test-key', token: 'test-token' };
  const target = createPolicy({ metadata, cloudPath, environment, credentials, now });
  const json = Buffer.from(target.form_data.policy, 'base64').toString(), policy = JSON.parse(json);
  for (const condition of [{ key: cloudPath }, { acl: 'private' }, { bucket: 'test-bucket' },
    { 'x-cos-meta-fileid': metadata.cosFileId }, ['content-length-range', 1, 20 * 1024 * 1024]]) {
    assert(policy.conditions.some(c => JSON.stringify(c) === JSON.stringify(condition)));
  }
  assert.equal(target.expires_at, now + 600000);
  assert(!JSON.stringify(target).includes(credentials.secretKey));
  assert(!JSON.stringify(target).includes(metadata.authorization));
  const signKey = crypto.createHmac('sha1', credentials.secretKey).update(target.form_data['q-key-time']).digest('hex');
  const sign = text => crypto.createHmac('sha1', signKey).update(crypto.createHash('sha1').update(text).digest('hex')).digest('hex');
  assert.equal(sign(json), target.form_data['q-signature']);
  assert.notEqual(sign(json.replace(cloudPath, 'another/key')), target.form_data['q-signature']);
});
test('非本环境、错误文件键、非HTTPS或错误桶的上传元数据不签发', () => {
  for (const altered of [
    { url: 'http://test-bucket.cos.ap-shanghai.myqcloud.com' },
    { url: 'https://other.cos.ap-shanghai.myqcloud.com' },
    { fileId: `cloud://other.test-bucket/${cloudPath}` },
    { fileId: `cloud://${environment}.test-bucket/other` },
  ]) {
    assert.throws(() => createPolicy({ metadata: { ...metadata, ...altered }, cloudPath, environment,
      credentials: { secretId: 'test-id', secretKey: 'test-key', token: 'test-token' } }));
  }
});
