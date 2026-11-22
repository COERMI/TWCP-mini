/* Shared local-demo model. This does not implement authentication or cloud authorization. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TransportWorkflow = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const BASE = ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT'];
  const TASKS = {
    WAYBILL: ['货运单', '拍清运单，四个角和字都要清楚。多份运单可以再拍一张。', 'paper'],
    DOOR_OPEN: ['开门拍照', '每次开门都要拍，包括卸货、检查和临时开门。拍清打开的车门、车厢内货物和现场，可拍多张。', 'cargo'],
    DOOR_CLOSE: ['关门拍照', '本次关门时，拍清关好的车门和锁闭状态，可补拍车牌。最后一次卸货也要拍。', 'door'],
    CARGO_PHOTO: ['货物码放', '拍清货物怎么摆，固定杆、棉被、布帘和留出的风道尽量拍全。', 'cargo'],
    LOADED_COMPARTMENT: ['装好的车厢', '拍装好后的车厢全景，尽量把货物和固定措施拍全。', 'cargo'],
    EMPTY_COMPARTMENT: ['装货前空车厢', '还没装货，拍车厢里面。地面、角落和清洁情况尽量拍全。', 'empty'],
    PRECOOL_TEMP: ['预冷温度仪表', '拍车辆温度显示屏，数字要清楚。这是仪表照片，不是天气温度。', 'temperature'],
    SEALED_VEHICLE: ['封车和车牌', '拍关好的车门和车牌，车牌要看得清。', 'door'],
    LOADED_TEMP: ['装货后温度仪表', '装好并打冷后，再拍一次车辆温度显示屏。', 'temperature'],
    UNLOAD_DOOR: ['开门前的车门', '开门前，先拍车门和车牌。', 'door'],
    UNLOAD_TEMP: ['到货温度仪表', '开门前拍温度显示屏，数字要清楚。', 'temperature'],
    UNLOAD_CARGO: ['开门后的货物', '开门后先拍里面的货物，先别急着卸。', 'cargo'],
    UNLOAD_SITE: ['卸货位置', '拍清正在卸货的地方，周围环境也拍进去。', 'site'],
    UNLOAD_PROCESS: ['卸货过程', '拍正在卸的货和搬运过程。有破损，再去“有问题拍照”拍近一点。', 'cargo'],
    UNLOAD_AFTER: ['卸完后的车厢', '中途卸货，拍车厢和剩余货物；最后一站全部卸完，再拍空车厢。', 'after'],
    RECEIPT: ['签收单', '拍签好字的单子，四个角和字都要清楚。还没拿到可以稍后补。', 'paper'],
    ISSUE_WIDE: ['问题现场全景', '先拍清楚发生问题的位置和周围情况。', 'site'],
    ISSUE_CLOSE: ['问题细节', '破损、短少或其他问题，再拍近一点。', 'cargo'],
  };
  const GROUPS = {
    door: { title: '开关门', types: ['DOOR_OPEN', 'DOOR_CLOSE'] },
    before: { title: '装货前拍照', types: ['EMPTY_COMPARTMENT', 'PRECOOL_TEMP'] },
    after: { title: '装货后拍照', types: ['SEALED_VEHICLE', 'LOADED_TEMP'] },
    unload: { title: '卸货', types: ['UNLOAD_DOOR', 'UNLOAD_TEMP', 'UNLOAD_CARGO', 'UNLOAD_SITE', 'UNLOAD_PROCESS', 'UNLOAD_AFTER', 'RECEIPT'] },
    issue: { title: '问题现场', types: ['ISSUE_WIDE', 'ISSUE_CLOSE'] },
  };
  const id = prefix => `${prefix}_${globalThis.crypto.randomUUID()}`;
  const now = () => new Date().toISOString();
  const DRIVER = { id: 'driver-a', name: '演示司机甲', role: '司机' };
  const HELPER = { id: 'helper-b', name: '演示协助者乙', role: '现场协助' };
  const visible = event => event.photos.filter(photo => !photo.deleted);
  const archived = event => visible(event).filter(photo => photo.status === 'ready');
  const groupLabel = group => ['door', 'unload', 'issue'].includes(group.kind)
    ? `第 ${group.sequence} 次${GROUPS[group.kind].title}` : GROUPS[group.kind].title;
  function normalize(store) {
    store.invites ||= [];
    store.actor ||= { ...DRIVER };
    for (const record of store.records) {
      record.groups ||= []; record.audit ||= []; record.missed ||= {};
      record.description ||= '本趟运输 · 请核对车牌'; record.shipDate ||= record.createdAt.slice(0, 10);
      record.preparedAt ||= record.createdAt; record.departedAt ||= null;
      record.deliveryConfirmedAt ||= null;
      for (const event of record.events) {
        event.group_id ||= null;
        for (const photo of event.photos) {
          photo.record_id ||= record.id; photo.event_id ||= event.id;
          photo.group_id ||= event.group_id;
          photo.uploader ||= { id: 'legacy', name: '历史演示拍摄者（未核验）', role: '未核验' };
        }
      }
      if (!store.invites.some(invite => invite.record_id === record.id)) {
        store.invites.push({
          id: `invite_${record.id}`, record_id: record.id, createdAt: record.preparedAt,
          allowed_actor: DRIVER.id, claimed_by: record.events.some(event => visible(event).length) ? DRIVER.id : null,
        });
      }
    }
    store.invites.forEach(invite => { if (!invite.claimed_by && !invite.allowed_actor) invite.allowed_actor = DRIVER.id; });
    if (!store.records.some(record => record.id === store.currentId)) store.currentId = store.records[0]?.id || null;
    return store;
  }
  function prepare(store, input) {
    const plate = String(input.plate || '').trim().toUpperCase();
    if (!/^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-HJ-NP-Z0-9挂学警港澳]{5,6}$/.test(plate)) throw new Error('请填写完整车牌，例如粤B12345');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.shipDate || '')) throw new Error('请填写发货日期');
    const description = String(input.description || '').trim();
    if (!description) throw new Error('请填写司机能认出的装货地或目的地方向');
    const ym = input.shipDate.slice(0, 7).replace('-', '');
    const prefix = `TR${ym}`;
    const next = Math.max(0, ...store.records.filter(record => record.no.startsWith(prefix)).map(record => Number(record.no.slice(prefix.length)) || 0)) + 1;
    const record = {
      id: id('record'), no: prefix + String(next).padStart(4, '0'), plate,
      createdAt: now(), preparedAt: now(), shipDate: input.shipDate, description,
      batch: String(input.batch || '').trim(), events: [], groups: [], audit: [], missed: {},
      submittedAt: null, deliveryConfirmedAt: null, departedAt: null,
    };
    const recipient = [DRIVER.id, HELPER.id].includes(input.recipientId) ? input.recipientId : DRIVER.id;
    const invite = { id: id('invite'), record_id: record.id, createdAt: now(), allowed_actor: recipient, claimed_by: null };
    store.records.unshift(record); store.invites.unshift(invite);
    return { record, invite };
  }
  function inviteAccess(store, inviteId, actor = store.actor, claim = false) {
    const invite = store.invites.find(item => item.id === inviteId);
    if (!invite || invite.revokedAt) throw new Error('这个拍照入口已失效，请联系发入口的人');
    const record = store.records.find(item => item.id === invite.record_id);
    if (!record) throw new Error('没有找到这趟运输，请联系负责人');
    if ((invite.allowed_actor && invite.allowed_actor !== actor.id) || (invite.claimed_by && invite.claimed_by !== actor.id)) {
      throw new Error('这个入口已关联其他拍摄者，请联系负责人发接续入口');
    }
    if (claim && !invite.claimed_by) {
      invite.claimed_by = actor.id; invite.claimedAt = now();
      record.audit.push({ type: 'claim_invitation', at: now(), actor: { ...actor }, invite_id: invite.id });
    }
    return { invite, record, claimed: invite.claimed_by === actor.id };
  }
  function continuation(store, record, actor) {
    const invite = { id: id('invite'), record_id: record.id, createdAt: now(), allowed_actor: actor.id, claimed_by: null };
    store.invites.unshift(invite);
    record.audit.push({ type: 'issue_continuation', at: now(), actor: { id: 'admin-demo', name: '演示负责人' }, for_actor: { ...actor }, invite_id: invite.id });
    return invite;
  }
  function committed(record, group) {
    return !!group.completedAt || !!group.notes?.length || !!group.noteDraft || record.events.some(event => event.group_id === group.id && visible(event).length)
      || Object.keys(record.missed).some(key => key.startsWith(`${group.id}:`));
  }
  function startGroup(record, kind) {
    if (!GROUPS[kind]) throw new Error('未知现场类型');
    if (kind === 'door') {
      if (record.deliveryConfirmedAt) throw new Error('本趟已完成运输，请先纠正为继续运输');
      if (!baseSubmitted(record)) throw new Error('运输前请先依次拍齐并提交货运单、货物码放、装好的车厢');
    }
    if (kind === 'unload' && record.deliveryConfirmedAt) throw new Error('已确认送完，请补已有卸货照片，或先纠正为继续送货');
    let group = record.groups.find(group => group.kind === kind && (!['door', 'unload', 'issue'].includes(kind) || !group.completedAt));
    if (!group) {
      group = {
        id: id('scene'), kind, createdAt: now(), completedAt: null, outcome: null,
        sequence: Math.max(0, ...record.groups.filter(group => group.kind === kind).map(group => group.sequence)) + 1,
      };
      record.groups.push(group);
    }
    return group;
  }
  function ensureEvent(record, type, group = null) {
    if (!TASKS[type]) throw new Error('未知拍摄项目');
    if (group && !record.groups.includes(group)) throw new Error('现场不属于这趟运输');
    if (group && !GROUPS[group.kind].types.includes(type)) throw new Error('照片项目与当前现场不匹配');
    if (group?.kind === 'door' && type === 'DOOR_CLOSE' && !hasGroupPhoto(record, group, 'DOOR_OPEN')) {
      throw new Error('请先将本次开门照片上传归档，再拍关门照片');
    }
    if (BASE.includes(type)) {
      const preceding = BASE.slice(0, BASE.indexOf(type));
      if (!preceding.every(previous => record.events.some(event => event.type === previous && !event.group_id && archived(event).length))) {
        throw new Error('请按运单 → 货物 → 车厢的顺序完成基础照片');
      }
    }
    let event = record.events.find(event => event.type === type && (event.group_id || null) === (group?.id || null));
    if (!event) {
      event = { id: id('event'), type, group_id: group?.id || null, sequence: group?.sequence || 1, createdAt: now(), photos: [] };
      record.events.push(event);
    }
    return event;
  }
  function attachPhoto(record, event, photo, actor) {
    if (!record.events.includes(event)) throw new Error('事件不属于这趟运输');
    if ((photo.record_id && photo.record_id !== record.id) || (photo.event_id && photo.event_id !== event.id)
      || (photo.group_id && photo.group_id !== event.group_id)) throw new Error('照片已绑定原趟、原现场，不能移动');
    const existing = record.events.flatMap(item => item.photos).find(item => item.id === photo.id);
    if (existing) {
      if (existing.event_id !== event.id) throw new Error('不能把同一张照片挪到另一现场');
      return existing;
    }
    const saved = { ...photo, record_id: record.id, event_id: event.id, group_id: event.group_id || null, uploader: { ...actor } };
    event.photos.push(saved); return saved;
  }
  function pending(record) {
    return record.events.flatMap(event => visible(event).filter(photo => ['queued', 'uploading', 'failed', 'original_received', 'watermark_failed'].includes(photo.status))
      .map(photo => ({ event, photo, group: record.groups.find(group => group.id === event.group_id) || null })));
  }
  function missing(record) {
    const requirements = [
      ...BASE.map(type => ({ type, group_id: null, label: TASKS[type][0] })),
      ...['before', 'after'].flatMap(kind => {
        const group = record.groups.find(group => group.kind === kind);
        return GROUPS[kind].types.filter(type => group && record.missed[`${group.id}:${type}`])
          .map(type => ({ type, group_id: group.id, kind, label: TASKS[type][0] }));
      }),
      ...record.groups.filter(group => group.kind === 'door' && committed(record, group)).flatMap(group =>
        GROUPS.door.types.map(type => ({ type, group_id: group.id, kind: 'door', label: `${groupLabel(group)} · ${TASKS[type][0]}` }))),
      ...record.groups.filter(group => group.kind === 'unload' && committed(record, group)).flatMap(group =>
        GROUPS.unload.types.map(type => ({ type, group_id: group.id, kind: 'unload', label: `${groupLabel(group)} · ${TASKS[type][0]}` }))),
    ];
    return requirements.filter(requirement => {
      const key = `${requirement.group_id || 'base'}:${requirement.type}`;
      return record.missed[key] || !record.events.some(event => event.type === requirement.type &&
        (event.group_id || null) === requirement.group_id && archived(event).length);
    }).map(requirement => ({ ...requirement, missed: record.missed[`${requirement.group_id || 'base'}:${requirement.type}`] || null }));
  }
  function markMissed(record, type, group, actor) {
    if (BASE.includes(type) || group?.kind === 'door') throw new Error('基础照片和每次开关门照片必须拍摄，不能跳过');
    if (group && (!record.groups.includes(group) || !GROUPS[group.kind].types.includes(type))) throw new Error('缺项与本趟现场不匹配');
    record.missed[`${group?.id || 'base'}:${type}`] ||= { at: now(), actor: { ...actor }, reason: '当时未拍' };
  }
  function finishStop(record, group, choice, actor) {
    if (group.kind !== 'unload' || !record.groups.includes(group)) throw new Error('请选择本趟实际卸货记录');
    if (!['more', 'none', 'unsure'].includes(choice)) throw new Error('请选择是否还有下一站');
    if (record.deliveryConfirmedAt) {
      if (record.finalGroupId === group.id && choice === 'none') return;
      throw new Error('已确认送完，请先纠正状态');
    }
    if (choice === 'none' && record.groups.some(other => other.kind === 'unload' && other.sequence > group.sequence && committed(record, other))) {
      throw new Error('后面还有卸货记录，请在最近一次卸货确认是否送完');
    }
    group.completedAt ||= now(); group.outcome = choice;
    if (choice === 'none' && !record.deliveryConfirmedAt) {
      record.deliveryConfirmedAt = now(); record.finalGroupId = group.id;
      record.audit.push({ type: 'delivery_confirmed', at: record.deliveryConfirmedAt, actor: { ...actor }, group_id: group.id });
    } else {
      record.audit.push({ type: 'stop_finished', at: now(), actor: { ...actor }, group_id: group.id, outcome: choice });
    }
  }
  function correctDelivery(record, actor, reason) {
    if (!record.deliveryConfirmedAt) throw new Error('当前尚未确认全部送完');
    if (!String(reason || '').trim()) throw new Error('请填写纠正原因');
    record.audit.push({ type: 'delivery_corrected', at: now(), actor: { ...actor }, reason: String(reason).trim(), previous_confirmed_at: record.deliveryConfirmedAt });
    const group = record.groups.find(group => group.id === record.finalGroupId);
    if (group) group.outcome = 'corrected';
    record.deliveryConfirmedAt = null; record.finalGroupId = null;
  }
  function cancelEmptyGroup(record, group) {
    if (!group || committed(record, group)) return false;
    record.events = record.events.filter(event => event.group_id !== group.id);
    record.groups = record.groups.filter(item => item.id !== group.id); return true;
  }
  function baseReady(record) {
    return BASE.every(type => record.events.some(event => event.type === type && !event.group_id && archived(event).length));
  }
  function baseSubmitted(record) { return !!record.submittedAt && baseReady(record); }
  function submitBase(record) {
    if (!baseReady(record)) throw new Error('请先拍齐并归档三项运输前照片');
    record.submittedAt ||= now();
  }
  function hasGroupPhoto(record, group, type) {
    return record.events.some(event => event.group_id === group.id && event.type === type && archived(event).length);
  }
  function finishDoor(record, group, actor) {
    if (!record.groups.includes(group) || group.kind !== 'door') throw new Error('请选择本趟开关门记录');
    if (!GROUPS.door.types.every(type => hasGroupPhoto(record, group, type))) throw new Error('本次开门、关门照片均须上传归档后才能结束');
    if (pending(record).some(entry => entry.group?.id === group.id)) throw new Error('本次还有照片待处理，请先补传或重试');
    if (group.completedAt) return;
    group.completedAt = now();
    record.audit.push({ type: 'door_finished', at: group.completedAt, actor: { ...actor }, group_id: group.id });
  }
  function completionBlocker(record) {
    if (!baseSubmitted(record)) return '请先拍齐并提交三项运输前照片';
    const doors = record.groups.filter(group => group.kind === 'door');
    if (!doors.length) return '最后卸货也需要开门、关门拍照，请先完成本次拍照';
    if (doors.some(group => !group.completedAt || !GROUPS.door.types.every(type => hasGroupPhoto(record, group, type)))) {
      return '还有开关门记录未完成，请先拍齐并保存';
    }
    if (pending(record).length) return '还有照片待上传或处理，请先处理后再完成运输';
    return '';
  }
  function completeTransport(record, actor, reason = '') {
    if (record.deliveryConfirmedAt) return;
    const blocker = completionBlocker(record);
    if (blocker) throw new Error(blocker);
    const last = record.groups.filter(group => group.kind === 'door').sort((a, b) => b.sequence - a.sequence)[0];
    record.deliveryConfirmedAt = now(); record.finalGroupId = last.id;
    record.audit.push({ type: 'delivery_confirmed', at: record.deliveryConfirmedAt, actor: { ...actor }, group_id: last.id, reason });
  }
  function saveIssueNote(record, group, text, actor) {
    if (!record.groups.includes(group) || group.kind !== 'issue') throw new Error('请选择本趟问题记录');
    const note = String(text || '').trim();
    if (!note || note.length > 300) throw new Error('请填写 1 至 300 字的问题说明');
    group.notes ||= [];
    group.notes.push({ text: note, at: now(), actor: { ...actor } });
  }
  return { BASE, TASKS, GROUPS, DRIVER, HELPER, id, now, normalize, prepare, inviteAccess, continuation,
    groupLabel, committed, startGroup, ensureEvent, attachPhoto, pending, missing, markMissed, finishStop,
    correctDelivery, cancelEmptyGroup, visible, archived, baseReady, baseSubmitted, submitBase,
    hasGroupPhoto, finishDoor, completionBlocker, completeTransport, saveIssueNote };
});
