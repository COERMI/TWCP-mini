const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { archiveEnvironment, uploadArchive } = require('../cloudfunctions/transportV1/archive-upload');
const environment = 'cloud1-d3go2mtsga3f8ea74';
const cloudPath = `transport-v1/archive/trip_${'a'.repeat(40)}/photo_${'b'.repeat(64)}/${'c'.repeat(64)}/original`;
const env = {
  TENCENTCLOUD_SECRETID: 'test-role-id', TENCENTCLOUD_SECRETKEY: 'test-role-key',
  TENCENTCLOUD_SESSIONTOKEN: 'test-role-session', TENCENTCLOUD_RUNENV: 'SCF', SCF_NAMESPACE: environment,
  WX_API_TOKEN: 'caller-token', WX_OPENID: 'caller', WX_CONTEXT_KEYS: 'WX_API_TOKEN,WX_OPENID',
  TCB_SESSIONTOKEN: 'caller-session', TCB_UUID: 'caller-uid', TCB_CONTEXT_KEYS: 'TCB_SESSIONTOKEN,TCB_UUID',
  ADMIN_SECRET: 'test-admin', INVITE_SECRET: 'test-invite', NODE_OPTIONS: '--require caller-hook',
};
test('归档工作线程仅继承平台临时角色凭据，不继承微信身份、会话及业务密钥', () => {
  const selected = archiveEnvironment(env);
  assert.equal(selected.TENCENTCLOUD_SECRETKEY, 'test-role-key');
  for (const key of ['WX_API_TOKEN', 'WX_OPENID', 'WX_CONTEXT_KEYS', 'TCB_SESSIONTOKEN', 'TCB_UUID',
    'TCB_CONTEXT_KEYS', 'ADMIN_SECRET', 'INVITE_SECRET', 'NODE_OPTIONS']) assert.equal(selected[key], undefined);
  assert.equal(env.WX_API_TOKEN, 'caller-token');
});
test('隔离上传返回唯一文件ID，缺平台身份或非法目录拒绝，绝不降级为司机身份上传', async () => {
  let options, terminated = false;
  class FakeWorker extends EventEmitter {
    constructor(file, input) {
      super(); options = input;
      process.nextTick(() => this.emit('message', { fileID: 'cloud://synthetic-archive-id' }));
    }
    async terminate() { terminated = true; }
  }
  assert.equal(await uploadArchive(cloudPath, Buffer.from('original'), { environment, env, Worker: FakeWorker }),
    'cloud://synthetic-archive-id');
  assert(terminated); assert.equal(options.env.WX_API_TOKEN, undefined);
  await assert.rejects(uploadArchive(cloudPath, Buffer.from('original'), { environment, env: {} }), /ARCHIVE_IDENTITY_UNAVAILABLE/);
  await assert.rejects(uploadArchive('transport-v1/incoming/source', Buffer.from('original'), { environment, env }), /INVALID_ARCHIVE_PATH/);
});
test('隔离线程错误不返回平台密钥或SDK内部错误', async () => {
  class BrokenWorker extends EventEmitter {
    constructor() { super(); process.nextTick(() => this.emit('error', new Error('secret=private'))); }
    async terminate() {}
  }
  await assert.rejects(uploadArchive(cloudPath, Buffer.from('original'), { environment, env, Worker: BrokenWorker }),
    error => error.message === 'ARCHIVE_UPLOAD_FAILED');
});
