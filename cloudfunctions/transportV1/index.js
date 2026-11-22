'use strict';
const cloud = require('wx-server-sdk');
const { createStore } = require('./store');
const { createService } = require('./service');
const { createMedia } = require('./media');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });
const service = createService({
  store: createStore(db),
  media: createMedia(cloud),
  config: {
    environment: process.env.V1_ENV_ID,
    appId: process.env.V1_APP_ID,
    adminUsername: process.env.ADMIN_USERNAME,
    adminSecret: process.env.ADMIN_SECRET,
    inviteSecret: process.env.INVITE_SECRET,
  },
});
exports.main = event => {
  const context = cloud.getWXContext();
  // CLI invocations may lack ENV in WeChat context; namespace is supplied by SCF.
  return service.main(event, {
    ...context, ENV: context.ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE,
  });
};
