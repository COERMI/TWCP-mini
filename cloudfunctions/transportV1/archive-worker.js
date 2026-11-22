'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const cloudbase = require('@cloudbase/node-sdk');
const { createPolicy } = require('./upload-policy');
async function run() {
  const app = cloudbase.init({
    env: workerData.environment,
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    sessionToken: process.env.TENCENTCLOUD_SESSIONTOKEN,
    timeout: 15000,
  });
  if (workerData.operation === 'sign') {
    const response = await app.getUploadMetadata({ cloudPath: workerData.cloudPath });
    const data = response.data;
    if (!data || !data.url || !data.authorization || !data.token || !data.fileId || !data.cosFileId) {
      throw new Error('UPLOAD_SIGN_FAILED');
    }
    parentPort.postMessage({ target: createPolicy({
      metadata: data, cloudPath: workerData.cloudPath, environment: workerData.environment,
      credentials: {
        secretId: process.env.TENCENTCLOUD_SECRETID, secretKey: process.env.TENCENTCLOUD_SECRETKEY,
        token: process.env.TENCENTCLOUD_SESSIONTOKEN,
      },
    }) });
    return;
  }
  const uploaded = await app.uploadFile({
    cloudPath: workerData.cloudPath, fileContent: Buffer.from(workerData.fileContent),
  });
  if (!uploaded.fileID || uploaded.code) throw new Error('ARCHIVE_UPLOAD_FAILED');
  parentPort.postMessage({ fileID: uploaded.fileID });
}
run().catch(() => parentPort.postMessage({ failed: true }));
