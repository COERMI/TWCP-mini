'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
// wx-server-sdk propagates the caller's WeChat token to storage. Archive objects
// must instead be created by the server identity so PRIVATE ACL protects them.
// A fresh worker has a separate SDK instance and a strict environment allowlist;
// never clear or mutate request identity in the main function.
function archiveEnvironment(source) {
  return Object.fromEntries([
    'PATH', 'NODE_PATH', 'HOME', 'TMPDIR', 'TZ',
    'TENCENTCLOUD_RUNENV', 'SCF_NAMESPACE', 'TCB_ENV',
    'TENCENTCLOUD_SECRETID', 'TENCENTCLOUD_SECRETKEY', 'TENCENTCLOUD_SESSIONTOKEN',
  ].filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}
function archiveOperation(operation, cloudPath, fileContent, options = {}) {
  const valid = operation === 'sign' ?
    /^transport-v1\/incoming\/trip_[a-f0-9]{40}\/photo_[a-f0-9]{64}\/[a-f0-9]{64}\.jpg$/.test(cloudPath) :
    /^transport-v1\/archive\/trip_[a-f0-9]{40}\/photo_[a-f0-9]{64}\/[a-f0-9]{64}\/(original|server-pango-v1\.(png|jpg))$/.test(cloudPath);
  if (!valid) {
    return Promise.reject(new Error('INVALID_ARCHIVE_PATH'));
  }
  const environment = options.environment || process.env.V1_ENV_ID;
  if (environment !== 'cloud1-d3go2mtsga3f8ea74') return Promise.reject(new Error('WRONG_ENV'));
  const env = archiveEnvironment(options.env || process.env), WorkerClass = options.Worker || Worker;
  if (!env.TENCENTCLOUD_SECRETID || !env.TENCENTCLOUD_SECRETKEY || !env.TENCENTCLOUD_SESSIONTOKEN) {
    return Promise.reject(new Error('ARCHIVE_IDENTITY_UNAVAILABLE'));
  }
  return new Promise((resolve, reject) => {
    const worker = new WorkerClass(path.join(__dirname, 'archive-worker.js'), {
      env, workerData: { operation, environment, cloudPath, fileContent },
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      worker.terminate().catch(() => {});
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('ARCHIVE_UPLOAD_TIMEOUT')), 20000);
    worker.once('message', message => {
      if (operation === 'sign' && message && message.target) finish(null, message.target);
      else if (operation === 'upload' && message && message.fileID) finish(null, message.fileID);
      else finish(new Error('ARCHIVE_UPLOAD_FAILED'));
    });
    worker.once('error', () => finish(new Error('ARCHIVE_UPLOAD_FAILED')));
    worker.once('exit', () => finish(new Error('ARCHIVE_WORKER_EXITED')));
  });
}
const uploadArchive = (cloudPath, fileContent, options) => archiveOperation('upload', cloudPath, fileContent, options);
const signIncoming = (cloudPath, options) => archiveOperation('sign', cloudPath, null, options);
module.exports = { uploadArchive, signIncoming, archiveEnvironment };
