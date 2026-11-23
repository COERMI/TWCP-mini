'use strict';
const crypto = require('node:crypto');
const A = require('./auth');
const { makeWorkflow } = require('./workflow');
const { makeAdmin } = require('./admin');
const COLLECTIONS = Object.freeze({
  records: 'transport_v1_records',
  invites: 'transport_v1_invites',
  requests: 'transport_v1_requests',
  audit: 'transport_v1_audit',
  counters: 'transport_v1_counters',
  events: 'transport_v1_events',
  photos: 'transport_v1_photos',
});
const VERSION = 'transport-v1-admin-3';
const DAY = 24 * 3600000;
const PLATE = /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-HJ-NP-Z0-9挂学警港澳]{5,6}$/;
function publicRecord(record) {
  return {
    id: record._id, record_no: record.record_no, plate_number: record.plate_number,
    ship_date: record.ship_date, description: record.description, batch: record.batch,
    phase: record.phase, created_at: record.created_at, confirmed_at: record.confirmed_at,
    departed_at: record.departed_at, completed_at: record.completed_at,
    revision: record.revision, schema_version: record.schema_version,
    invite_revoked_at: record.invite_revoked_at || null,
  };
}
function createService({ store, config, clock = Date.now, media }) {
  function checkEnvironment(context) {
    if (config.environment !== 'cloud1-d3go2mtsga3f8ea74' || context.ENV !== config.environment) {
      A.fail('WRONG_ENV', '当前版本仅在已确认的测试环境开放');
    }
  }
  function invitation(record) {
    // A retry can reconstruct the same high-entropy capability without storing it in plaintext.
    if (typeof config.inviteSecret !== 'string' || config.inviteSecret.length < 32) {
      A.fail('NOT_CONFIGURED', '运输入口签发尚未配置');
    }
    return crypto.createHmac('sha256', config.inviteSecret)
      .update(`transport-v1:invite:${record._id}:${record.invite_salt}`).digest('hex');
  }
  function inviteHash(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) A.fail('INVITE_UNAVAILABLE', '这个入口无效，请联系发入口的人');
    return A.sha(value);
  }
  const ref = (tx, key, id) => ({
    get: () => tx.get(COLLECTIONS[key], id),
    set: data => tx.set(COLLECTIONS[key], id, data),
  });
  async function getInvite(tx, token) {
    const invite = await ref(tx, 'invites', inviteHash(token)).get();
    if (!invite || invite.revoked_at) A.fail('INVITE_UNAVAILABLE', '这个入口已失效，请联系发入口的人');
    const record = await ref(tx, 'records', invite.record_id).get();
    if (!record || record.schema_version !== 1) A.fail('INVITE_UNAVAILABLE', '这个入口已失效，请联系发入口的人');
    return { invite, record };
  }
  function checkInvite(invite, record, actor, now) {
    if (record.owner_openid && record.owner_openid !== actor.id) {
      A.fail('FORBIDDEN', '这个入口已关联其他拍摄者，请联系负责人');
    }
    // The same bound driver may resume a trip after invitation claim expiry.
    if (!record.owner_openid && invite.expires_at <= now) {
      A.fail('INVITE_EXPIRED', '这个入口已过期，请联系发入口的人');
    }
  }
  async function audit(tx, id, record, actor, action, now) {
    await ref(tx, 'audit', id).set({
      _id: id, record_id: record._id, action, actor_kind: actor.kind,
      actor_id: actor.id, at: now, revision: record.revision,
    });
  }
  async function prepare(input, context) {
    const now = clock(), actor = A.admin(input.token, config, now);
    const key = A.requestId(input.request_id);
    const plate = A.text(input.plate_number, 20).toUpperCase();
    const date = A.text(input.ship_date, 20);
    const description = A.text(input.description, 121), batch = A.text(input.batch, 61);
    if (!PLATE.test(plate)) A.fail('INVALID_PLATE', '请填写完整车牌');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      A.fail('INVALID_DATE', '请填写有效发货日期');
    }
    if (!description || description.length > 120 || batch.length > 60) A.fail('INVALID_INPUT', '请填写装货地或目的地方向，说明不超过120字');
    const payload = { plate_number: plate, ship_date: date, description, batch };
    const fingerprint = A.sha(JSON.stringify(payload));
    const id = `trip_${A.sha(`${actor.id}:${key}`).slice(0, 40)}`;
    // Generated once outside transaction callback, stable across SDK conflict retries.
    const salt = crypto.randomBytes(32).toString('hex');
    return store.transaction(async tx => {
      const old = await ref(tx, 'records', id).get();
      if (old) {
        if (old.create_fingerprint !== fingerprint) A.fail('REQUEST_CONFLICT', '该请求已创建其他内容，请刷新后重试');
        const token = invitation(old);
        const invite = await ref(tx, 'invites', A.sha(token)).get();
        if (!invite || invite.revoked_at || (!old.owner_openid && invite.expires_at <= now)) {
          A.fail('INVITE_UNAVAILABLE', '本趟原入口已失效，请从后台查看本趟运输');
        }
        return { record: publicRecord(old), invite: token, invite_expires_at: invite.expires_at };
      }
      const ym = new Date(now + 8 * 3600000).toISOString().slice(0, 7).replace('-', '');
      const counterId = `record_${ym}`, counter = await ref(tx, 'counters', counterId).get();
      const seq = (counter?.seq || 0) + 1;
      if (!Number.isSafeInteger(seq) || seq < 1) A.fail('COUNTER_INVALID', '档案编号异常，请联系管理员');
      const record = { _id: id, schema_version: 1, record_no: `TR${ym}${String(seq).padStart(6, '0')}`,
        ...payload, phase: 'awaiting_plate', owner_openid: null, revision: 0,
        created_at: now, updated_at: now, confirmed_at: null, departed_at: null, completed_at: null,
        created_by: actor.id, create_fingerprint: fingerprint, invite_salt: salt };
      const token = invitation(record), hash = A.sha(token), expires = now + 7 * DAY;
      await ref(tx, 'counters', counterId).set({ _id: counterId, seq, year_month: ym });
      await ref(tx, 'records', id).set(record);
      await ref(tx, 'invites', hash).set({ _id: hash, record_id: id, created_at: now,
        expires_at: expires, claimed_at: null, revoked_at: null });
      await audit(tx, `prepared_${id}`, record, actor, 'prepare_trip', now);
      return { record: publicRecord(record), invite: token, invite_expires_at: expires };
    });
  }
  async function preview(input, context) {
    const actor = A.driver(context, config), now = clock();
    return store.transaction(async tx => {
      const { invite, record } = await getInvite(tx, input.invite);
      checkInvite(invite, record, actor, now);
      // An unclaimed invitation reveals only what is needed to confirm the plate.
      if (!record.owner_openid) return {
        record: { plate_number: record.plate_number, ship_date: record.ship_date,
          description: record.description }, claimed: false,
      };
      return { record: publicRecord(record), claimed: true };
    });
  }
  async function claim(input, context) {
    const actor = A.driver(context, config), now = clock();
    const key = A.requestId(input.request_id);
    return store.transaction(async tx => {
      const { invite, record } = await getInvite(tx, input.invite);
      checkInvite(invite, record, actor, now);
      if (input.confirm_plate !== record.plate_number) A.fail('PLATE_MISMATCH', '车牌不符，请联系发入口的人重新发送');
      const requestDoc = `claim_${A.sha(`${actor.id}:${key}`)}`;
      const oldRequest = await ref(tx, 'requests', requestDoc).get();
      if (oldRequest && oldRequest.record_id !== record._id) A.fail('REQUEST_CONFLICT', '请求编号已用于其他运输');
      if (!record.owner_openid) {
        record.owner_openid = actor.id;
        record.phase = 'preparing';
        record.confirmed_at = now; record.updated_at = now; record.revision++;
        invite.claimed_at = now;
        await ref(tx, 'records', record._id).set(record);
        await ref(tx, 'invites', invite._id).set(invite);
        await audit(tx, `claimed_${record._id}`, record, actor, 'confirm_plate_and_claim', now);
      }
      if (!oldRequest) await ref(tx, 'requests', requestDoc).set({
        _id: requestDoc, record_id: record._id, actor_id: actor.id, action: 'claim', created_at: now,
      });
      return { record: publicRecord(record), claimed: true };
    });
  }
  async function get(input, context) {
    const actor = A.driver(context, config);
    if (typeof input.record_id !== 'string' || !/^trip_[a-f0-9]{40}$/.test(input.record_id)) A.fail('INVALID_RECORD', '缺少本趟运输编号');
    const record = await store.get(COLLECTIONS.records, input.record_id);
    if (!record || !record.owner_openid || record.owner_openid !== actor.id) A.fail('FORBIDDEN', '无权查看这趟运输');
    return { record: publicRecord(record) };
  }
  async function adminGet(input) {
    A.admin(input.token, config, clock());
    if (typeof input.record_id !== 'string' || !/^trip_[a-f0-9]{40}$/.test(input.record_id)) A.fail('INVALID_RECORD', '缺少本趟运输编号');
    const record = await store.get(COLLECTIONS.records, input.record_id);
    if (!record) A.fail('NOT_FOUND', '没有找到这趟运输');
    return { record: publicRecord(record), claimed: Boolean(record.owner_openid) };
  }
  async function revoke(input) {
    const now = clock(), actor = A.admin(input.token, config, now);
    return store.transaction(async tx => {
      const hash = inviteHash(input.invite), invite = await ref(tx, 'invites', hash).get();
      if (!invite) A.fail('INVITE_UNAVAILABLE', '这个入口无效');
      const record = await ref(tx, 'records', invite.record_id).get();
      if (!record) A.fail('NOT_FOUND', '没有找到这趟运输');
      if (record.owner_openid) A.fail('ALREADY_CLAIMED', '本趟已有司机确认，请使用受控交接流程');
      if (!invite.revoked_at) {
        invite.revoked_at = now;
        record.invite_revoked_at = now; record.updated_at = now; record.revision++;
        await ref(tx, 'invites', hash).set(invite);
        await ref(tx, 'records', record._id).set(record);
        await audit(tx, `revoked_${hash}`, record, actor, 'revoke_unclaimed_invite', now);
      }
      return { revoked: true };
    });
  }
  async function adminInvite(input) {
    const now = clock();
    A.admin(input.token, config, now);
    if (typeof input.record_id !== 'string' || !/^trip_[a-f0-9]{40}$/.test(input.record_id)) A.fail('INVALID_RECORD', '缺少本趟运输编号');
    return store.transaction(async tx => {
      const record = await ref(tx, 'records', input.record_id).get();
      if (!record || record.schema_version !== 1) A.fail('NOT_FOUND', '没有找到这趟运输');
      // A claimed invitation is for resuming the bound driver's trip, never for
      // assigning another driver. Do not expose it through the dispatch UI.
      if (record.owner_openid) A.fail('ALREADY_CLAIMED', '司机已确认本趟运输，请由原司机使用原入口接续');
      const token = invitation(record);
      const invite = await ref(tx, 'invites', A.sha(token)).get();
      if (!invite || invite.record_id !== record._id || invite.revoked_at) A.fail('INVITE_UNAVAILABLE', '本趟入口已失效，请核对后重新创建运输');
      if (invite.expires_at <= now) A.fail('INVITE_EXPIRED', '本趟入口已过期，请核对后重新创建运输');
      return { record: publicRecord(record), invite: token, invite_expires_at: invite.expires_at };
    });
  }
  const actions = { prepare, preview, claim, get, adminGet, adminInvite, revoke,
    ...makeWorkflow({ store, config, clock, media, collections: COLLECTIONS }),
    ...makeAdmin({ store, config, clock, media, collections: COLLECTIONS }) };
  return {
    async main(input = {}, context = {}) {
      try {
        checkEnvironment(context);
        if (!input || typeof input !== 'object' || Array.isArray(input)) A.fail('INVALID_INPUT', '请求格式不正确');
        const action = Object.hasOwn(actions, input.action) && actions[input.action];
        if (!action) A.fail('INVALID_ACTION', '不支持的操作');
        return { success: true, data: await action(input, context), version: VERSION };
      } catch (error) {
        // Never return SDK internals, credentials, OPENIDs or raw input in an error.
        return { success: false, code: error.businessCode || 'RETRY_LATER',
          message: error.businessCode ? error.message : '处理未完成，请用原请求重试', version: VERSION };
      }
    },
  };
}
module.exports = { createService, COLLECTIONS, VERSION };
