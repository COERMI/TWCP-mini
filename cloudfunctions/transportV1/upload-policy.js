'use strict';
const crypto = require('node:crypto');
// COS POST policy signing: https://cloud.tencent.com/document/product/436/14690
// Do not rely on generic upload metadata as a client grant. This explicit
// policy binds bucket, exact key, private ACL,
// metadata, 20MB size limit and a ten-minute lifetime.
function createPolicy({ metadata, cloudPath, environment, credentials, now = Date.now() }) {
  const { secretId, secretKey, token } = credentials;
  if (!secretId || !secretKey || !token) throw new Error('UPLOAD_IDENTITY_UNAVAILABLE');
  const url = new URL(metadata.url);
  const prefix = `cloud://${environment}.`, slash = metadata.fileId.indexOf('/', prefix.length);
  const bucket = metadata.fileId.slice(prefix.length, slash);
  if (url.protocol !== 'https:' || !metadata.fileId.startsWith(prefix) ||
      metadata.fileId.slice(slash + 1) !== cloudPath ||
      !url.hostname.startsWith(bucket + '.cos.') || !url.hostname.endsWith('.myqcloud.com')) {
    throw new Error('UPLOAD_METADATA_MISMATCH');
  }
  const start = Math.floor(now / 1000) - 30, end = Math.floor(now / 1000) + 600, keyTime = `${start};${end}`;
  const fields = {
    key: cloudPath, acl: 'private', 'x-cos-meta-fileid': metadata.cosFileId,
    'x-cos-security-token': token, success_action_status: '204',
    'q-sign-algorithm': 'sha1', 'q-ak': secretId, 'q-key-time': keyTime,
  };
  const policy = JSON.stringify({
    expiration: new Date(end * 1000).toISOString(),
    conditions: [
      { bucket }, { key: cloudPath }, { acl: 'private' },
      { 'x-cos-meta-fileid': metadata.cosFileId }, { 'x-cos-security-token': token },
      { success_action_status: '204' }, ['content-length-range', 1, 20 * 1024 * 1024],
      { 'q-sign-algorithm': 'sha1' }, { 'q-ak': secretId }, { 'q-sign-time': keyTime },
    ],
  });
  const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex');
  const stringToSign = crypto.createHash('sha1').update(policy).digest('hex');
  fields.policy = Buffer.from(policy).toString('base64');
  fields['q-signature'] = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return { url: metadata.url, file_id: metadata.fileId, expires_at: end * 1000, form_data: fields };
}
module.exports = { createPolicy };
