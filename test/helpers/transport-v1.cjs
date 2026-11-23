'use strict';
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createService, COLLECTIONS } = require('../../cloudfunctions/transportV1/service');
const NOW = Date.parse('2026-11-22T08:00:00Z');
const config = {
  environment: 'cloud1-d3go2mtsga3f8ea74', appId: 'wx2c993513e03bb60a',
  adminUsername: 'test-admin', adminSecret: 'test-only-admin-secret',
  inviteSecret: 'test-only-invite-secret-32-characters',
};
const actor = id => ({ ENV: config.environment, APPID: config.appId, OPENID: id });
function setup() {
  let now = NOW, revision = 0, sequence = 0, data = new Map();
  const files = new Map(), downloads = [], uploads = [];
  const store = {
    get: async (collection, id) => structuredClone(data.get(`${collection}/${id}`) || null),
    list: async (collection, filter, cursor, limit) => [...data.entries()]
      .filter(([key, row]) => key.startsWith(collection + '/') && row._id > cursor &&
        Object.entries(filter).every(([key, value]) => row[key] === value))
      .map(([, row]) => structuredClone(row)).sort((a, b) => a._id < b._id ? -1 : 1).slice(0, limit),
    searchRecords: async (collection, o) => {
      const rows = [...data.entries()].filter(([key]) => key.startsWith(collection + '/')).map(([, row]) => structuredClone(row))
        .filter(r => (!o.keyword || [r.record_no, r.plate_number].some(v => v.toLowerCase().includes(o.keyword.toLowerCase()))) &&
          (!o.phase || (o.source === 'v1' ? r.phase === o.phase : r.status === (o.phase === 'legacy_submitted' ? 'submitted' : 'active'))) &&
          (o.from === null || new Date(r.created_at).getTime() >= o.from) && (o.to === null || new Date(r.created_at).getTime() < o.to))
          .sort((a, b) => {
            const field = o.sort === 'updated_desc' ? 'updated_at' : 'created_at';
            return new Date(b[field] || 0) - new Date(a[field] || 0) || b._id.localeCompare(a._id);
          });
      return { total: rows.length, list: rows.slice((o.page - 1) * o.pageSize, o.page * o.pageSize) };
    },
    async transaction(callback) {
      for (let n = 0; n < 100; n++) {
        const base = revision, snapshot = structuredClone(data);
        const result = await callback({
          get: async (collection, id) => structuredClone(snapshot.get(`${collection}/${id}`) || null),
          set: async (collection, id, row) => snapshot.set(`${collection}/${id}`, structuredClone(row)),
        });
        if (base !== revision) continue;
        data = snapshot; revision++; return result;
      }
      throw new Error('Conflict retries exhausted');
    },
  };
  const media = {
    signUpload: async key => ({ url: 'https://synthetic-upload.invalid',
      form_data: { key }, file_id: `cloud://${config.environment}.test-bucket/${key}` }),
    download: async id => { downloads.push(id); if (!files.has(id)) throw new Error('MISSING_FILE'); return Buffer.from(files.get(id)); },
    upload: async (key, bytes) => {
      const id = `cloud://${config.environment}.test-bucket/${key}`;
      files.set(id, Buffer.from(bytes)); uploads.push(id); return id;
    },
    render: async (bytes, context) => ({ buffer: Buffer.concat([bytes, Buffer.from(JSON.stringify(context))]),
      version: 'test-render-v1', extension: 'png', output: { width: 1200, height: 1800 } }),
    links: async ids => Object.fromEntries(ids.map(id => [id, 'signed-test-link'])),
  };
  const service = createService({ store, config, media, clock: () => now });
  const call = (input, context = actor('driver-a')) => service.main(input, context);
  const ok = async (input, context) => {
    const result = await call(input, context);
    assert.equal(result.success, true, `${input.action}: ${result.code} ${result.message}`);
    return result.data;
  };
  const request = () => `request_${String(++sequence).padStart(12, '0')}`;
  const mutate = (action, record_id, input = {}, context) => ok({ action, record_id, request_id: request(), ...input }, context);
  const trip = async (owner = 'driver-a') => {
    const payload = Buffer.from(JSON.stringify({ sub: config.adminUsername, iat: now, exp: now + 600000 })).toString('base64url');
    const token = payload + '.' + crypto.createHmac('sha256', config.adminSecret).update(payload).digest('base64url');
    const prepared = await ok({ action: 'prepare', token, request_id: request(), plate_number: '粤B12345',
      ship_date: '2026-11-22', description: 'TEST transport' });
    await mutate('claim', prepared.record.id, { invite: prepared.invite, confirm_plate: '粤B12345' }, actor(owner));
    return prepared.record.id;
  };
  const event = async (id, kind, type) => (await mutate('startEvent', id, { kind, type })).event.id;
  const reserve = (id, event_id, type, extra = {}) => mutate('reservePhoto', id, { event_id, type, capture_time: NOW, ...extra });
  const process = async (id, reserved, bytes = Buffer.from('synthetic image')) => {
    const file_id = `cloud://${config.environment}.test-bucket/${reserved.cloud_path}`;
    files.set(file_id, bytes);
    return ok({ action: 'processPhoto', record_id: id, photo_id: reserved.photo.id, file_id });
  };
  const photo = async (id, event_id, type) => {
    const reserved = await reserve(id, event_id, type);
    const result = await process(id, reserved);
    assert.equal(result.photo.status, 'ready');
    return result.photo.id;
  };
  const base = async id => {
    const photos = [];
    for (const type of ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT']) photos.push(await photo(id, await event(id, 'base', type), type));
    await mutate('submitBase', id);
    return photos;
  };
  const door = async id => {
    const e = await event(id, 'door');
    const open = await photo(id, e, 'DOOR_OPEN'), close = await photo(id, e, 'DOOR_CLOSE');
    await mutate('finishDoor', id, { event_id: e });
    return { id: e, open, close };
  };
  return { call, ok, mutate, request, trip, event, reserve, process, photo, base, door, files, downloads, uploads, media, store,
    advance: ms => { now += ms; },
    docs: key => [...data.entries()].filter(([k]) => k.startsWith(COLLECTIONS[key] + '/')).map(([, row]) => structuredClone(row)),
  };
}
module.exports = { setup, config, actor, NOW, COLLECTIONS };
