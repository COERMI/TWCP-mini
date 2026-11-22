/* Local interaction prototype only. No camera, location, SDK, credentials or network requests. */
(() => {
  'use strict';
  const W = window.TransportWorkflow;
  const session = (new URLSearchParams(location.search).get('session') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  const STORAGE_KEY = 'transport-photo-prototype-v1' + (session ? '-' + session : '');
  // Owner confirmed on 2026-11-21: retain the original strict base-task order.
  const FIXED = ['WAYBILL', 'CARGO_PHOTO', 'LOADED_COMPARTMENT'];
  const NAMES = { ...Object.fromEntries(Object.entries(W.TASKS).map(([type, task]) => [type, task[0]])), DOOR_OPEN: '开门拍照', DOOR_CLOSE: '关门拍照' };
  const STATUSES = {
    queued: '照片还在手机里 · 等待上传', uploading: '正在上传原图', original_received: '原图已收，水印处理中',
    failed: '上传失败 · 等待重试', watermark_failed: '原图已收，水印失败', ready: '✓ 已归档',
  };
  const app = document.getElementById('app');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = prefix => `${prefix}_${crypto.randomUUID()}`;
  const time = value => value ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value)) : '—';
  const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const validPhotos = event => event.photos.filter(photo => !photo.deleted && ['ready', 'watermark_failed', 'original_received'].includes(photo.status));
  const visiblePhotos = event => event.photos.filter(photo => !photo.deleted);
  const eventLabel = event => event.group_id || FIXED.includes(event.type) ? NAMES[event.type] : `第 ${event.sequence} 次${NAMES[event.type] || '现场记录'}`;
  const businessEvents = record => record.events.filter(event => validPhotos(event).length > 0);
  const recordPhotoCount = record => record.events.reduce((sum, event) => sum + validPhotos(event).length, 0);
  const completed = record => FIXED.filter(type => record.events.some(event => event.type === type && !event.group_id && validPhotos(event).some(photo => photo.status === 'ready'))).length;
  const hasArchived = (item, type) => item.events.some(event => event.type === type && validPhotos(event).some(photo => photo.status === 'ready'));
  const unlocked = (item, type) => !FIXED.includes(type) || FIXED.slice(0, FIXED.indexOf(type)).every(previous => hasArchived(item, previous));
  const fixtureTime = index => new Date(Date.UTC(2026, 10, 21, 9, index)).toISOString();
  const makePhoto = (index, status = 'ready') => ({
    id: `demo_photo_${index}`, captureTime: fixtureTime(index), receivedAt: fixtureTime(index + 1),
    location: '演示地点 · 未调用实际定位', accuracy: 20, coordSystem: 'GCJ-02', status,
    deleted: false, scene: index, attempts: 1, watermarkVersion: 'prototype-v1',
  });
  function initialState() {
    return {
      currentId: 'demo_loaded', records: [
        { id: 'demo_empty', no: 'TR2026110002', plate: '粤B12345', createdAt: fixtureTime(0), submittedAt: null, events: [] },
        { id: 'demo_loaded', no: 'TR2026110001', plate: '粤B12345', createdAt: fixtureTime(0), submittedAt: fixtureTime(10), events: [
          { id: 'demo_cargo', type: 'CARGO_PHOTO', sequence: 1, createdAt: fixtureTime(1), photos: [makePhoto(1)] },
          { id: 'demo_compartment', type: 'LOADED_COMPARTMENT', sequence: 1, createdAt: fixtureTime(3), photos: [makePhoto(3)] },
          { id: 'demo_waybill', type: 'WAYBILL', sequence: 1, createdAt: fixtureTime(5), photos: [makePhoto(5)] },
          { id: 'demo_open_1', type: 'DOOR_OPEN', sequence: 1, createdAt: fixtureTime(12), photos: [makePhoto(12), makePhoto(14), makePhoto(16, 'failed')] },
          { id: 'demo_close_1', type: 'DOOR_CLOSE', sequence: 1, createdAt: fixtureTime(20), photos: [makePhoto(20)] },
          { id: 'demo_open_2', type: 'DOOR_OPEN', sequence: 2, createdAt: fixtureTime(25), photos: [makePhoto(25)] },
        ] },
      ],
    };
  }
  let data;
  let persistence = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    data = saved && Array.isArray(saved.records) && saved.records.length ? saved : initialState();
  } catch { data = initialState(); persistence = false; }
  W.normalize(data);
  // Interrupted local simulation stays retryable; it never pretends an upload finished.
  data.records.forEach(record => record.events.forEach(event => event.photos.forEach(photo => {
    if (photo.status === 'uploading') photo.status = 'failed';
    if (photo.status === 'original_received') photo.status = 'watermark_failed';
  })));
  data.records.forEach(record => { record.events = record.events.filter(event => visiblePhotos(event).length > 0); });
  let view = 'home', mode = 'driver', eventId = null, capture = null, adminRecordId = null, lastViewKey = null;
  let groupId = null, taskIndex = 0, inviteId = null, inviteError = '', invitationPanel = null, largeText = false, muted = false;
  const inFlight = new Set();
  let filter = { query: '', start: '', end: '', status: '' }, page = 1;
  let viewer = null, confirmAction = null, toastTimer, confirmNeedsReason = false;
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch { persistence = false; }
  }
  function record() { return data.records.find(item => item.id === data.currentId); }
  function currentEvent() { return record()?.events.find(item => item.id === eventId); }
  function currentGroup() { return record()?.groups.find(item => item.id === groupId); }
  const ownerName = item => escape(item.description || '本趟运输');
  function groupEvents(item, group) { return item.events.filter(event => event.group_id === group.id); }
  function groupPhotoCount(item, group) { return groupEvents(item, group).reduce((count, event) => count + validPhotos(event).length, 0); }
  function prioritizedMissing(item) {
    return W.missing(item).sort((a, b) => {
      if ((a.type === 'RECEIPT') !== (b.type === 'RECEIPT')) return a.type === 'RECEIPT' ? -1 : 1;
      if (a.type === 'RECEIPT') return (item.groups.find(group => group.id === b.group_id)?.sequence || 0) - (item.groups.find(group => group.id === a.group_id)?.sequence || 0);
      return 0;
    });
  }
  function deliveryLabel(item) {
    const confirmation = [...item.audit].reverse().find(entry => entry.type === 'delivery_confirmed' && entry.at === item.deliveryConfirmedAt);
    if (confirmation?.actor?.id === 'admin-demo') return '负责人已代确认全部送完';
    if (confirmation?.actor?.id === data.actor.id) return '你已确认全部送完';
    return confirmation?.actor?.role === '现场协助' ? '现场协助者已确认全部送完' : '司机已确认全部送完';
  }
  function helpControls() {
    return `<details class="help-disclosure"><summary>大字、语音与联系负责人</summary><div class="help-controls"><button class="secondary" data-action="large" aria-pressed="${largeText}">大字提示</button><button class="secondary" data-action="listen">听提示</button><button class="secondary" data-action="mute" aria-pressed="${muted}">${muted ? '开启语音' : '静音'}</button><button class="secondary" data-action="contact">联系负责人</button></div></details>`;
  }
  function tripHeader(item) {
    return `<h2>${escape(item.plate)}</h2><p class="trip-identity">${escape(item.shipDate)} · ${ownerName(item)}</p><div class="record-no">${escape(item.no)}</div>`;
  }
  function toast(text) {
    document.getElementById('toast').textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { document.getElementById('toast').textContent = ''; }, 4000);
  }
  function ask(title, message, action, yes = '确认', no = '保留', needsReason = false) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-yes').textContent = yes;
    document.getElementById('confirm-no').textContent = no;
    confirmAction = action;
    confirmNeedsReason = needsReason;
    document.getElementById('confirm-reason-block').hidden = !needsReason;
    document.getElementById('confirm-reason').value = '';
    document.getElementById('confirm-dialog').showModal();
  }
  function render() {
    const viewKey = `${mode}:${view}:${data.currentId}:${eventId || ''}:${groupId || ''}:${taskIndex}:${adminRecordId || ''}`;
    document.querySelectorAll('.tab').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.action === mode)));
    if (mode === 'admin') {
      app.innerHTML = view === 'prepare' ? prepareView() : invitationPanel ? invitationPanelView() : adminRecordId ? adminDetail() : adminList();
    } else {
      const views = { home, record: recordView, event: eventView, camera: cameraView, invitation: invitationView,
        loading: loadingView, group: groupView,
        'wrong-plate': wrongPlateView, materials: materialsView, correction: correctionView, queue: queueView };
      const content = (views[view] || home)();
      app.innerHTML = `<section class="phone ${largeText ? 'large-text' : ''}"><div class="phone-top"><span>运输照片采集</span><small>流程演示 · 无真实上传</small></div><div class="phone-content">${content}<p class="prototype-foot">${persistence ? '本浏览器保存演示进度' : '当前浏览器无法保存进度，请勿刷新'} · ${escape(data.actor.name)}</p></div></section>`;
    }
    if (document.getElementById('photo-dialog').open && viewer) updateViewer();
    if (viewKey !== lastViewKey) { window.scrollTo(0, 0); lastViewKey = viewKey; }
  }
  function home() {
    const selected = new URLSearchParams(location.search).get('invite');
    if (selected) {
      try {
        const access = W.inviteAccess(data, selected);
        data.currentId = access.record.id; inviteId = selected; inviteError = '';
        return access.claimed ? recordView() : invitationView();
      } catch (error) { inviteError = error.message; return invitationView(); }
    }
    return `<span class="eyebrow">本趟运输拍照</span><h2 class="page-title">请打开负责人发来的入口</h2><p class="capture-hint">每趟运输一个专属入口。先核对车牌，再跟着提示拍照。</p><div class="notice">没有收到入口，或入口车牌不对，请联系负责人核对后重新发送。</div><button class="primary full" data-action="contact">联系负责人</button><p class="muted">演示体验：切换上方「总部后台」，准备本趟拍照并模拟司机打开。</p>${helpControls()}`;
  }

  function recordView() {
    const item = record(), pending = W.pending(item), ready = W.baseSubmitted(item);
    const next = FIXED.find(type => !hasArchived(item, type));
    const active = item.groups.find(group => group.kind === 'door' && !group.completedAt);
    const groups = item.groups.filter(group => W.committed(item, group)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const legacy = item.events.filter(event => !event.group_id && !FIXED.includes(event.type) && visiblePhotos(event).length);
    const done = !!item.deliveryConfirmedAt;
    const blocker = W.completionBlocker(item);
    return `${tripHeader(item)}
      ${done ? `<div class="delivery-strip delivered"><span>✓ 本趟运输已完成</span><small>${deliveryLabel(item)} · ${time(item.deliveryConfirmedAt)}</small></div><p class="muted">这是已完成的本趟入口。下一趟请使用负责人新发的入口。</p>` : `
      <section class="base-priority"><div class="section-head"><h3>${ready ? '✓ 运输前三项已提交' : '运输前必须拍齐'}</h3><span class="tag">${completed(item)}/3</span></div>${ready ? '' : `<ol class="base-steps">${FIXED.map((type, index) => `<li class="${hasArchived(item, type) ? 'step-done' : next === type ? 'step-current' : ''}">${index + 1}. ${NAMES[type]}${hasArchived(item, type) ? ' ✓' : ''}</li>`).join('')}</ol>`}
      ${!ready ? `<button class="primary full" data-action="${next ? 'begin' : 'submit'}" ${next ? `data-type="${next}"` : ''}>${next ? `${completed(item) ? '继续拍' : '开始拍'}${NAMES[next]}` : '提交三项，进入运输拍照'}</button><p class="muted">按顺序完成并提交后，进入途中开关门拍照。</p>` : ''}</section>
      ${ready ? `<div class="section-head"><h3>每次开门、关门都要拍</h3></div><p class="muted">卸货、检查、临时开门，都记录在本趟。</p><div class="scene-actions"><button class="scene-entry ${active && W.hasGroupPhoto(item, active, 'DOOR_OPEN') ? 'secondary' : 'primary'}" data-action="door-open"><span class="scene-number">开</span><span><strong>${active ? W.hasGroupPhoto(item, active, 'DOOR_OPEN') ? '开门已拍，可补拍' : '继续本次开门拍照' : '开门拍照'}</strong><small>${active ? W.groupLabel(active) : '新的一次，单独保存'}</small></span><span>›</span></button><button class="scene-entry ${active && W.hasGroupPhoto(item, active, 'DOOR_OPEN') ? 'primary' : 'secondary'}" data-action="door-close" ${active && W.hasGroupPhoto(item, active, 'DOOR_OPEN') ? '' : 'disabled'}><span class="scene-number">关</span><span><strong>关门拍照</strong><small>${active ? '与本次开门放在同一组' : '先拍本次开门，再拍关门'}</small></span><span>›</span></button></div>` : ''}`}
      ${pending.length ? `<button class="queue-banner" data-action="queue">${pending.length} 张照片待处理 · 去补传 ›</button>` : ''}
      <button class="issue-entry secondary full" data-action="issue">＋ 问题反馈 <small>随时拍照、记录说明</small></button>
      ${ready && !done ? `<div class="finish-transport"><button class="primary full" data-action="complete-transport" ${blocker ? 'disabled' : ''}>全部卸货完毕，完成运输</button><p class="muted">${blocker || '确认所有货物已卸完，没有下一站要送。'}</p></div>` : ''}
      ${done ? '<button class="text-button full" data-action="correction">误点完成？纠正为继续运输</button>' : ''}
      <details class="task-checklist"><summary>查看本趟已拍照片${groups.length ? ` · ${groups.length} 组现场` : ''}</summary>${baseRows(item)}
      ${groups.map(group => `<button class="timeline-row" data-action="open-group" data-id="${escape(group.id)}"><span class="task-body"><strong>${W.groupLabel(group)}</strong><small>${groupPhotoCount(item, group)} 张已收${group.kind === 'door' ? group.completedAt ? ' · 本次已保存' : ' · 本次尚未结束' : ''}</small></span><span>查看 ›</span></button>`).join('')}
      ${legacy.map(event => `<button class="timeline-row" data-action="open-event" data-id="${escape(event.id)}">旧版 ${eventLabel(event)} · ${validPhotos(event).length} 张 ›</button>`).join('')}</details>
      <details class="task-checklist"><summary>其他照片（按需拍摄）</summary><button class="secondary full" data-action="start-group" data-kind="before">空车厢、预冷温度</button><button class="secondary full" data-action="start-group" data-kind="after">封车车牌、装后温度</button></details>${helpControls()}`;
  }

  function baseRows(item) {
    return FIXED.map((type, index) => {
        const event = item.events.find(event => event.type === type), photos = event ? validPhotos(event) : [];
        const locked = !unlocked(item, type);
        return `<button class="task" data-action="begin" data-type="${type}" ${locked ? 'disabled' : ''}><span class="task-icon">${['▧', '▤', '▣'][index]}</span><span class="task-body"><strong>${index + 1}. ${NAMES[type]}</strong><small>${locked ? `未解锁 · 先完成${NAMES[FIXED[index - 1]]}` : photos.length ? `${photos.length} 张已收 · 可查看、补拍` : '待拍摄'}</small></span>${photos.some(photo => photo.status === 'ready') ? '<span class="tag">✓ 已归档</span>' : locked ? '<span class="tag neutral">待解锁</span>' : ''}<span class="chevron">›</span></button>`;
      }).join('');
  }
  function outcomeLabel(value) {
    return ({ more: '还有下一站', none: '已确认全部送完', unsure: '下一站待确认', corrected: '已纠正，继续送货' })[value] || '拍摄中';
  }
  function invitationView() {
    if (inviteError) return `<button class="back" data-action="home">‹ 返回入口</button><h2>这个入口暂时不能用</h2><div class="notice">${escape(inviteError)}</div><p class="muted">不会把这趟照片转给其他人，也不会自动新建运输。</p><button class="primary full" data-action="contact">联系发入口的人</button>${helpControls()}`;
    const item = record();
    return `<span class="eyebrow">你收到的本趟拍照邀请</span><h2 style="margin-top:18px">先看看，是不是你的车？</h2><div class="invitation-plate">${escape(item.plate)}</div><p class="trip-identity">${escape(item.shipDate)} · ${ownerName(item)}</p>${item.batch ? `<p class="muted">批次 ${escape(item.batch)}</p>` : ''}<div class="record-no">${escape(item.no)}</div>
      ${item.deliveryConfirmedAt ? '<div class="notice">这趟已确认送完，仍可补这趟的照片。旧入口不会变成新的一趟。</div>' : '<p class="muted">同一个入口再打开，还会回到这趟。</p>'}
      <button class="primary full" data-action="claim-invite">车牌对，${item.deliveryConfirmedAt ? '补这趟照片' : '开始拍照'}</button><button class="plate-mismatch full" data-action="wrong-plate">车牌不对，请重新发入口</button>
      <p class="muted">演示拍摄者：${escape(data.actor.name)}。本页不是真实身份授权。</p>${helpControls()}`;
  }
  function wrongPlateView() {
    return `<h2 class="page-title">车牌不符，先别拍</h2><div class="plate-warning"><strong>入口车牌：${escape(record().plate)}</strong><p>请联系发入口的负责人，核对正确车牌后重新发送本趟入口。</p></div><button class="primary full" data-action="contact">联系发入口的负责人</button><button class="secondary full" data-action="open-invite" data-id="${escape(inviteId)}">返回核对车牌</button>`;
  }
  function loadingView() {
    return recordView();
  }

  function groupView() {
    const item = record(), group = currentGroup(), types = W.GROUPS[group.kind].types;
    if (group.kind === 'door') return doorView(item, group);
    taskIndex = Math.max(0, Math.min(taskIndex, types.length - 1));
    const type = types[taskIndex], task = W.TASKS[type];
    const event = groupEvents(item, group).find(event => event.type === type);
    const photos = event ? visiblePhotos(event) : [], missed = item.missed[`${group.id}:${type}`];
    const retryPhoto = photos.find(photo => ['queued', 'failed'].includes(photo.status));
    const hint = type === 'UNLOAD_AFTER' && group.outcome === 'none' ? '这是最后一站，拍全部卸完后的空车厢。' : task[1];
    return `<button class="back" data-action="leave-group">‹ 返回本趟</button><div class="scene-context">${escape(item.plate)} · ${W.groupLabel(group)}</div>
      <div class="task-progress"><span>拍摄提示</span><span>${taskIndex + 1} / ${types.length}</span></div><h2>${task[0]}</h2><p class="capture-hint">${hint}</p>
      <img class="task-illustration" alt="${task[0]}拍摄示意，不是真实照片" src="${image(item, { type, group_id: group.id, sequence: group.sequence }, { scene: 1 }, false)}">
      ${missed ? '<div class="notice warning">已记录当时未拍；现在补拍会保留真实时间，仍需总部核查缺项。</div>' : ''}
      <button class="primary full" data-action="${retryPhoto ? 'retry' : photos.length ? 'next-task' : 'capture'}" ${retryPhoto ? `data-id="${escape(retryPhoto.id)}"` : ''}>${retryPhoto ? '这张没传上去，重试' : photos.length ? taskIndex === types.length - 1 ? '这次先拍到这里' : '下一项 →' : '拍这张'}</button>
      ${photos.length ? '<button class="secondary full" data-action="capture">再拍一张</button>' : ''}
      <div class="section-head"><h3>这一项的照片</h3><span class="muted">${event ? validPhotos(event).length : 0} 张已收</span></div>${event ? photoRows(event, item) : '<div class="empty">看清上面的提示，再点“拍这张”。</div>'}
      ${group.kind !== 'issue' && !photos.length && !missed ? '<button class="text-button" data-action="missed">当时没拍到，记录缺项</button>' : ''}
      <details class="task-checklist"><summary>查看本次拍照清单</summary>${types.map((type, index) => {
        const taskEvent = groupEvents(item, group).find(event => event.type === type);
        return `<button class="checklist-row" data-action="select-task" data-index="${index}"><span>${index + 1}. ${W.TASKS[type][0]}</span><small>${item.missed[`${group.id}:${type}`] ? '当时未拍' : taskEvent && W.archived(taskEvent).length ? '✓ 已保存' : taskEvent && visiblePhotos(taskEvent).length ? '待处理' : '待拍'}</small></button>`;
      }).join('')}</details>
      ${!photos.length && group.kind !== 'issue' ? '<button class="secondary full" data-action="next-task">稍后补，先看下一项</button>' : ''}
      ${group.kind === 'issue' ? issueNotes(item, group) : ''}
      <button class="text-button full" data-action="finish-group">${group.kind === 'issue' ? '保存本次问题，返回本趟' : '返回本趟'}</button>${helpControls()}`;
  }
  function issueNotes(item, group) {
    return `<section class="issue-notes"><h3>问题说明</h3>${(group.notes || []).map(note => `<div class="notice">${escape(note.text)}<small class="note-author">${escape(note.actor.name)} · ${time(note.at)}</small></div>`).join('')}<form id="issue-note-form"><label for="issue-note">发生了什么？（可单独记录，也可配照片）</label><textarea id="issue-note" name="note" maxlength="300" required placeholder="例如：卸货时发现一箱外包装破损">${escape(group.noteDraft || '')}</textarea><button class="secondary full" type="submit">保存问题说明</button></form></section>`;
  }
  function doorView(item, group) {
    const type = W.GROUPS.door.types[taskIndex], event = groupEvents(item, group).find(event => event.type === type);
    const photos = event ? visiblePhotos(event) : [];
    const retry = photos.find(photo => ['queued', 'failed', 'watermark_failed'].includes(photo.status));
    const ready = W.hasGroupPhoto(item, group, type), busy = photos.some(photo => ['uploading', 'original_received'].includes(photo.status));
    return `<button class="back" data-action="leave-group">‹ 返回本趟</button><div class="scene-context">${escape(item.plate)} · ${W.groupLabel(group)}</div><div class="task-progress"><span>每次开门、关门都必拍</span><span>${taskIndex + 1}/2</span></div><h2>${NAMES[type]}</h2><p class="capture-hint">${W.TASKS[type][1]}</p>
      <img class="task-illustration" alt="${NAMES[type]}示意图" src="${image(item, { type, group_id: group.id, sequence: group.sequence }, { scene: 1 }, false)}">
      ${retry ? `<button class="primary full" data-action="${retry.status === 'watermark_failed' ? 'retry-watermark' : 'retry'}" data-id="${escape(retry.id)}">${retry.status === 'watermark_failed' ? '重试水印处理' : '重试上传这张照片'}</button>` : `<button class="${ready ? 'secondary' : 'primary'} full" data-action="capture">${photos.length ? '再拍一张' : '拍这张'}</button>`}
      ${ready ? type === 'DOOR_OPEN' ? `<button class="primary full" data-action="select-task" data-index="1">现在关门，去拍关门照片</button><button class="secondary full" data-action="leave-group">开门已拍，稍后回来拍关门</button>` : `<button class="primary full" data-action="finish-group" ${busy || retry ? 'disabled' : ''}>保存本次开关门记录</button>` : ''}
      ${busy ? '<div class="notice" role="status">照片处理中，请稍候…</div>' : ''}
      ${event ? photoRows(event, item) : ''}<div class="door-tabs"><button class="text-button" data-action="select-task" data-index="0">查看开门照片</button><button class="text-button" data-action="select-task" data-index="1" ${W.hasGroupPhoto(item, group, 'DOOR_OPEN') ? '' : 'disabled'}>查看关门照片</button></div>${helpControls()}`;
  }
  function materialsView() {
    const item = record(), missing = prioritizedMissing(item), pending = W.pending(item);
    const missingRow = entry => `<button class="task" data-action="go-missing" data-type="${entry.type}" data-group="${escape(entry.group_id || '')}" data-kind="${entry.kind || ''}"><span class="task-body"><strong>${escape(entry.label)}</strong><small>${entry.missed ? '当时未拍 · 可补拍现在的现场，历史缺项仍保留' : '尚无已归档照片 · 可以稍后补'}</small></span><span>›</span></button>`;
    return `<button class="back" data-action="record">‹ 返回本趟</button>${tripHeader(item)}<h2 class="page-title">${item.deliveryConfirmedAt ? '✓ ' + deliveryLabel(item) : missing.length ? '这些资料还要补' : '照片已收齐'}</h2>
      <div class="notice">${item.deliveryConfirmedAt ? `${deliveryLabel(item)} · ${time(item.deliveryConfirmedAt)}。` : '尚未确认全部送完。'}<br>${missing.length ? '照片资料尚未收齐，补传不会改变原来的所属运输。' : '资料状态只说明照片已归档，内容质量由总部核查。'}</div>
      ${pending.length ? `<button class="queue-banner" data-action="queue">${pending.length} 张照片等待上传或处理 ›</button>` : ''}
      <div class="section-head"><h3>${missing.length ? `还有 ${missing.length} 项资料待补` : '✓ 照片已收齐'}</h3></div>${missing.slice(0, 3).map(missingRow).join('')}
      ${missing.length > 3 ? `<details class="task-checklist"><summary>展开其余 ${missing.length - 3} 项待补资料</summary>${missing.slice(3).map(missingRow).join('')}</details>` : ''}
      ${item.deliveryConfirmedAt ? '<button class="text-button full" data-action="correction">点错了？还要继续送</button>' : ''}${helpControls()}`;
  }
  function correctionView() {
    return `<button class="back" data-action="record">‹ 返回本趟</button>${tripHeader(record())}<h2 class="page-title">还要继续送货</h2><p class="muted">照片不会被移动或删除。之前的送完确认会保留在操作记录里。</p><form id="correction-form"><label for="correction-reason">为什么要纠正？</label><select id="correction-reason" name="reason" required><option value="刚才误点了送完">刚才误点了送完</option><option value="还有货要送下一站">还有货要送下一站</option><option value="收货安排发生变化">收货安排发生变化</option></select><button class="primary full" type="submit">确认纠正，继续送货</button></form>${helpControls()}`;
  }
  function queueView() {
    const item = record(), entries = W.pending(item);
    return `<button class="back" data-action="record">‹ 返回本趟</button>${tripHeader(item)}<h2 class="page-title">待传与待处理照片</h2><p class="muted">每张照片都固定属于这趟、这次现场。新建另一趟也不会挪动它们。</p>
      ${entries.map(({ event, photo, group }) => `<button class="task" data-action="open-pending" data-id="${escape(photo.id)}"><span class="task-body"><strong>${group ? W.groupLabel(group) + ' · ' : ''}${eventLabel(event)}</strong><small>${STATUSES[photo.status]} · 首次 ${time(photo.captureTime)}</small></span><span>查看 ›</span></button>`).join('') || '<div class="empty">目前没有待传或待处理照片。</div>'}${helpControls()}`;
  }
  function prepareView() {
    return `<section class="admin"><div class="admin-header"><div><button class="back" data-action="admin-back">‹ 返回档案列表</button><h2>准备本趟拍照</h2><p class="muted">每趟建立独立入口，司机只需确认车牌。</p></div><span class="tag neutral">演示 · 不发送微信消息</span></div><div class="admin-content"><form id="prepare-form" class="prepare-form"><label for="prepare-plate">车牌号码</label><input id="prepare-plate" name="plate" value="粤B12345" maxlength="8" required><label for="prepare-date">发货日期</label><input id="prepare-date" name="shipDate" type="date" value="${day(Date.now())}" required><label for="prepare-description">装货地或目的地方向（给司机看）</label><input id="prepare-description" name="description" placeholder="例如：今天从昆明基地装货，往广州方向" maxlength="80" required><label for="prepare-batch">发货批次（可不填）</label><input id="prepare-batch" name="batch" maxlength="40"><button class="primary full" type="submit">生成本趟演示入口</button></form></div></section>`;
  }
  function inviteLink(id) {
    const url = new URL(location.href); url.searchParams.set('invite', id); return url.href;
  }
  function invitationPanelView() {
    const invite = data.invites.find(invite => invite.id === invitationPanel), item = data.records.find(item => item.id === invite.record_id);
    const helper = invite.allowed_actor === W.HELPER.id;
    return `<section class="admin"><div class="admin-header"><div><button class="back" data-action="admin-back">‹ 返回档案列表</button><h2>${helper ? '协助拍摄接续入口已准备' : '本趟拍照入口已准备'}</h2></div></div><div class="admin-content"><div class="invitation-panel"><span class="tag">独立档案 · ${escape(item.shipDate)}</span><h2>${escape(item.plate)}</h2><p>${ownerName(item)}</p><p class="record-no">${escape(item.no)}</p><label for="invitation-link">仅在本浏览器有效的演示入口</label><input id="invitation-link" value="${escape(inviteLink(invite.id))}" readonly><p class="muted">这是本地流程演示，未创建真实小程序邀请、未发送微信消息。正式版本需服务端授权校验。</p><button class="primary full" data-action="simulate-invite" data-id="${escape(invite.id)}" data-actor="${helper ? W.HELPER.id : W.DRIVER.id}">模拟${helper ? '协助者乙' : '司机甲'}打开这个入口</button></div></div></section>`;
  }
  function photoRows(event, item) {
    return visiblePhotos(event).map((photo, index) => `<div class="photo-row"><img alt="第 ${index + 1} 张演示照片缩略图" class="thumbnail" src="${image(item, event, photo, false)}"><div class="photo-body"><strong>照片 ${index + 1}</strong><small class="${photo.status === 'ready' ? 'status-ready' : ['queued', 'failed', 'watermark_failed'].includes(photo.status) ? 'status-error' : ''}">${STATUSES[photo.status]}</small><small>首次拍摄 ${time(photo.captureTime)}</small><small>${escape(photo.uploader?.name || '历史演示拍摄者')}</small><div class="photo-actions">
      ${['queued', 'failed'].includes(photo.status) ? `<button class="secondary" data-action="retry" data-id="${escape(photo.id)}">重试这张</button>` : ''}
      ${photo.status === 'watermark_failed' ? `<button class="secondary" data-action="retry-watermark" data-id="${escape(photo.id)}">重做水印</button>` : ''}
      ${!['queued', 'failed', 'uploading'].includes(photo.status) ? `<button class="secondary" data-action="view-photo" data-id="${escape(photo.id)}" data-event="${escape(event.id)}" data-record="${escape(item.id)}">查看</button>` : ''}
      ${!['uploading', 'original_received'].includes(photo.status) ? `<button class="secondary" data-action="remove" data-id="${escape(photo.id)}" data-event="${escape(event.id)}">移除</button>` : ''}</div></div></div>`).join('') || '<div class="empty">这一项还没有照片。</div>';
  }
  function eventView() {
    const event = currentEvent(), item = record();
    return `<button class="back" data-action="leave-event">‹ 返回本趟记录</button><h2>${eventLabel(event)}</h2><div class="muted">${escape(item.plate)} · ${escape(item.no)}</div>
      <p class="capture-hint">${W.TASKS[event.type]?.[1] || '拍清当前现场，同一次记录可以拍多张。'}</p><button class="primary full" data-action="capture">＋ ${visiblePhotos(event).length ? '再拍一张' : '拍这张'}</button>
      <p class="muted" style="margin-top:10px">在此拍摄的照片，都属于${eventLabel(event)}。</p>
      <div class="section-head"><h3>本次照片</h3><span class="muted">${validPhotos(event).length} 张已收</span></div>
      ${photoRows(event, item)}${event.type === 'LOADED_COMPARTMENT' && !item.submittedAt ? `<button class="primary full" data-action="submit" ${W.baseReady(item) ? '' : 'disabled'}>提交三项，进入运输拍照</button>` : ''}${FIXED.includes(event.type) && FIXED.indexOf(event.type) < 2 ? `<button class="secondary full" data-action="next-base" ${W.archived(event).length ? '' : 'disabled'}>下一项：${NAMES[FIXED[FIXED.indexOf(event.type) + 1]]}</button>` : ''}
      <button class="secondary full" data-action="leave-event">返回${FIXED.includes(event.type) ? '装货拍照' : '本趟记录'}</button>${helpControls()}`;
  }
  function cameraView() {
    const event = currentEvent();
    return `<button class="back" data-action="cancel-capture">‹ 返回${eventLabel(event)}</button><h2>看清了吗？</h2><div class="muted">${escape(record().plate)} · ${currentGroup() ? W.groupLabel(currentGroup()) + ' · ' : ''}${eventLabel(event)}</div>
      <img class="camera-image" alt="模拟拍摄预览，非真实现场照片" src="${image(record(), event, capture, false)}">
      <div class="muted">首次拍摄：${time(capture.captureTime)}<br>${escape(capture.location)}</div>
      <details class="demo-options"><summary>演示网络或处理失败</summary><div class="checks"><label><input type="checkbox" id="keep-local">先留在手机，稍后上传</label><label><input type="checkbox" id="fail-upload">本张首次上传失败</label><label><input type="checkbox" id="fail-watermark">水印失败，保留原图</label></div></details>
      <div class="actions"><button class="secondary" data-action="retake">重拍</button><button class="primary" data-action="use-photo">用这张</button></div>`;
  }
  function openInvite(selectedInvite) {
    const route = new URL(location.href);
    if (selectedInvite) route.searchParams.set('invite', selectedInvite); else route.searchParams.delete('invite');
    history.replaceState(null, '', route);
    inviteId = selectedInvite; groupId = null; eventId = null; capture = null; mode = 'driver'; inviteError = ''; invitationPanel = null;
    try {
      const access = W.inviteAccess(data, selectedInvite);
      data.currentId = access.record.id;
      if (access.claimed) { enterRecord(access.record); return; }
    } catch (error) { inviteError = error.message; }
    view = 'invitation'; save(); render();
  }
  function enterRecord(item) {
    data.currentId = item.id; groupId = null; eventId = null; capture = null;
    view = 'record'; save(); render();
  }
  function openGroup(group) {
    groupId = group.id;
    const types = W.GROUPS[group.kind].types;
    taskIndex = Math.max(0, types.findIndex(type => !groupEvents(record(), group).some(event => event.type === type && W.archived(event).length)));
    eventId = groupEvents(record(), group).find(event => event.type === types[taskIndex])?.id || null;
    view = 'group'; save(); render();
  }
  function leaveGroup() {
    const group = currentGroup(), kind = group?.kind, item = record();
    const leave = () => {
      W.cancelEmptyGroup(item, group); groupId = null; eventId = null; capture = null;
      view = 'record'; save(); render();
    };
    const pending = W.pending(item).filter(entry => entry.group?.id === group?.id && ['queued', 'failed'].includes(entry.photo.status));
    if (pending.length) return ask('还有照片留在手机里', `${pending.length} 张未上传。可以保留在这趟、这次现场，稍后回来重试。`, leave, '保留并返回', '继续处理');
    leave();
  }
  function finishGroup() {
    const group = currentGroup();
    if (group.kind === 'door') { W.finishDoor(record(), group, data.actor); leaveGroup(); return; }
    if (group.kind === 'unload') { leaveGroup(); return; }
    if (group.kind === 'issue' && group.noteDraft?.trim()) {
      W.saveIssueNote(record(), group, group.noteDraft, data.actor);
      group.noteDraft = '';
    }
    if (W.committed(record(), group)) group.completedAt ||= new Date().toISOString();
    leaveGroup();
  }
  function selectTask(index) {
    const group = currentGroup(), types = W.GROUPS[group.kind].types;
    if (group.kind === 'door' && index === 1 && !W.hasGroupPhoto(record(), group, 'DOOR_OPEN')) return toast('先拍本次开门照片并上传归档');
    taskIndex = Math.max(0, Math.min(index, types.length - 1));
    eventId = groupEvents(record(), group).find(event => event.type === types[taskIndex])?.id || null;
    view = 'group'; render();
  }
  function goMissing(button) {
    const type = button.dataset.type, id = button.dataset.group, kind = button.dataset.kind;
    if (FIXED.includes(type)) { begin(type); return; }
    const group = record().groups.find(group => group.id === id) || W.startGroup(record(), kind);
    groupId = group.id; taskIndex = W.GROUPS[group.kind].types.indexOf(type);
    eventId = groupEvents(record(), group).find(event => event.type === type)?.id || null;
    view = 'group'; save(); render();
  }
  function begin(type) {
    const item = record();
    if (!unlocked(item, type)) return toast('请按运单 → 货物 → 车厢的顺序完成基础照片');
    groupId = null;
    let event = FIXED.includes(type) ? item.events.find(event => event.type === type) : null;
    if (!event) {
      const sequence = FIXED.includes(type) ? 1 : Math.max(0, ...item.events.filter(event => event.type === type).map(event => event.sequence)) + 1;
      event = { id: uid('event'), type, sequence, createdAt: new Date().toISOString(), photos: [] };
      item.events.push(event);
    }
    eventId = event.id; view = 'event'; save(); render();
  }
  function newCapture() {
    if (view === 'group') {
      const group = currentGroup(), type = W.GROUPS[group.kind].types[taskIndex];
      eventId = W.ensureEvent(record(), type, group).id;
    }
    const event = currentEvent();
    if (!event) return toast('请先选择本次拍照项目');
    capture = {
      id: uid('photo'), captureTime: new Date().toISOString(), location: '演示地点 · 未调用实际定位',
      record_id: record().id, event_id: event.id, group_id: event.group_id || null,
      accuracy: null, coordSystem: 'GCJ-02', status: 'queued', deleted: false,
      scene: Math.floor(Math.random() * 10) + 30, attempts: 0,
    };
    view = 'camera'; render();
  }
  function upload(photo, watermarkOnly = false) {
    if (!photo || inFlight.has(photo.id)) return;
    inFlight.add(photo.id);
    photo.attempts = (photo.attempts || 0) + 1;
    photo.status = watermarkOnly ? 'original_received' : 'uploading';
    save(); render();
    setTimeout(() => {
      // Resetting the demo while a timer is running must not revive old records.
      if (!data.records.some(item => item.events.some(event => event.photos.includes(photo)))) { inFlight.delete(photo.id); return; }
      if (photo.failUpload && photo.attempts === 1 && !watermarkOnly) {
        photo.status = 'failed'; inFlight.delete(photo.id); save(); render(); return;
      }
      photo.receivedAt ||= new Date().toISOString();
      photo.status = 'original_received'; save(); render();
      setTimeout(() => {
        if (!data.records.some(item => item.events.some(event => event.photos.includes(photo)))) { inFlight.delete(photo.id); return; }
        photo.status = photo.failWatermark && !watermarkOnly ? 'watermark_failed' : 'ready';
        photo.watermarkVersion = photo.status === 'ready' ? 'prototype-v1' : null;
        inFlight.delete(photo.id);
        save(); render();
      }, 500);
    }, 650);
  }
  function leaveEvent() {
    const event = currentEvent();
    const leave = () => {
    if (event && event.photos.length === 0) record().events = record().events.filter(item => item !== event);
    eventId = null; capture = null; view = event && FIXED.includes(event.type) ? 'loading' : 'record'; save(); render();
    };
    if (event && visiblePhotos(event).some(photo => ['queued', 'failed'].includes(photo.status))) return ask('还有照片没传上去', '照片会保留在原来的这趟、这次记录里，回来后可以重试。', leave, '保留并返回', '继续处理');
    leave();
  }
  function submit() {
    const item = record();
    W.submitBase(item);
    groupId = null; eventId = null; view = 'record';
    save(); render(); toast('运输前三项已提交，途中每次开门、关门都要拍');
  }
  function removePhoto(photoId, selectedEventId) {
    const event = record().events.find(event => event.id === selectedEventId) || currentEvent(), photo = event.photos.find(photo => photo.id === photoId);
    if ((record().submittedAt && FIXED.includes(event.type) || record().groups.some(group => group.id === event.group_id && group.kind === 'door')) && photo.status === 'ready' &&
        validPhotos(event).filter(item => item.id !== photoId && item.status === 'ready').length === 0) {
      return toast('这是必拍项的最后一张，请先补拍一张并归档成功，再移除这张');
    }
    ask('移除这张照片？', `照片属于“${eventLabel(event)}”。确认后不再计入有效张数，其他照片会保留。`,
      reason => { photo.deleted = true; photo.deletedAt = new Date().toISOString(); photo.deletedBy = { ...data.actor }; photo.deletedReason = reason; save(); render(); toast('已移除，事件归属及操作原因保留'); }, '移除照片', '保留照片', true);
  }
  function adminList() {
    const rows = data.records.filter(item => {
      const query = filter.query.trim().toUpperCase(), date = day(item.createdAt);
      return (!query || item.plate.includes(query) || item.no.includes(query)) &&
        (!filter.start || date >= filter.start) && (!filter.end || date <= filter.end) &&
        (!filter.status || (filter.status === 'submitted' ? !!item.submittedAt : !item.submittedAt));
    });
    const maxPage = Math.max(1, Math.ceil(rows.length / 5));
    page = Math.min(page, maxPage);
    return `<section class="admin"><div class="admin-header"><div><span class="eyebrow">总部工作台</span><h2>运输档案</h2><p class="muted">送完确认与资料齐全，分开核对。</p></div><button class="primary" data-action="prepare">＋ 准备本趟拍照</button></div><div class="admin-content">
      <form id="filter-form" class="filters"><div><label for="query">车牌 / 档案编号</label><input id="query" name="query" value="${escape(filter.query)}" placeholder="输入车牌或档案号"></div><div><label for="start">开始日期 · 北京时间</label><input id="start" name="start" type="date" value="${escape(filter.start)}"></div><div><label for="end">结束日期 · 含当天</label><input id="end" name="end" type="date" value="${escape(filter.end)}"></div><div><label for="status">基础照片</label><select name="status" id="status"><option value="">全部状态</option><option value="submitted" ${filter.status === 'submitted' ? 'selected' : ''}>已提交</option><option value="active" ${filter.status === 'active' ? 'selected' : ''}>待提交</option></select></div><button class="primary" type="submit">查询</button></form>
      <div class="filter-bottom"><span>共 ${rows.length} 份档案 · 创建日期按北京时间筛选</span><button class="secondary" data-action="clear-filter">清空筛选</button></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>档案 / 本趟说明</th><th>准备时间</th><th>送货确认</th><th>资料状态</th><th>开关门</th><th>照片</th><th>操作</th></tr></thead><tbody>${rows.slice((page - 1) * 5, page * 5).map(item => `<tr><td><strong>${escape(item.plate)}</strong><div class="record-no">${escape(item.no)}</div><div class="muted">${ownerName(item)}</div></td><td>${time(item.preparedAt)}</td><td><span class="tag ${item.deliveryConfirmedAt ? '' : 'pending'}">${item.deliveryConfirmedAt ? '已确认送完' : '尚未确认送完'}</span><div class="muted">基础 ${completed(item)}/3${item.submittedAt ? ' · 已提交' : ''}</div></td><td>${W.missing(item).length ? `待补 ${W.missing(item).length} 项` : '照片已收齐'}</td><td>${item.groups.filter(group => group.kind === 'door' && W.committed(item, group)).length} 次</td><td>${recordPhotoCount(item)}</td><td><button class="secondary" data-action="admin-detail" data-id="${escape(item.id)}">查看详情</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">没有找到符合条件的档案。可以清空筛选后重试。</div>'}
      <div class="pagination"><button class="secondary" data-action="page-prev" ${page === 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${maxPage}</span><button class="secondary" data-action="page-next" ${page === maxPage ? 'disabled' : ''}>下一页</button></div></div></section>`;
  }
  function adminDetail() {
    const item = data.records.find(item => item.id === adminRecordId);
    const events = businessEvents(item);
    const standalone = events.filter(event => !event.group_id).sort((a, b) =>
      (FIXED.includes(a.type) ? FIXED.indexOf(a.type) : 10) - (FIXED.includes(b.type) ? FIXED.indexOf(b.type) : 10) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const groups = item.groups.filter(group => W.committed(item, group)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const missing = W.missing(item), pending = W.pending(item);
    const tiles = event => `<div class="photo-grid">${validPhotos(event).map((photo, index) => `<button class="photo-tile" data-action="view-photo" data-record="${escape(item.id)}" data-event="${escape(event.id)}" data-id="${escape(photo.id)}"><img alt="${eventLabel(event)}第 ${index + 1} 张演示照片" src="${image(item, event, photo, photo.status === 'ready')}"><span>${eventLabel(event)} ${index + 1} · ${photo.status === 'ready' ? '水印就绪' : '仅原图'}</span><span>${escape(photo.uploader?.name || '历史拍摄者未核验')}</span></button>`).join('')}</div>`;
    return `<section class="admin"><div class="admin-header"><div><button class="back" data-action="admin-back">‹ 返回档案列表</button><h2>${escape(item.plate)}</h2><p>${escape(item.shipDate)} · ${ownerName(item)}</p><div class="record-no">${escape(item.no)}</div></div><button class="secondary" data-action="continuation">准备协助拍摄接续入口</button></div><div class="admin-content">
      <div class="record-info"><div><small>档案准备时间</small><strong>${time(item.preparedAt)}</strong></div><div><small>首次照片设备时间</small><strong>${time(item.events.flatMap(event => event.photos).map(photo => photo.captureTime).filter(Boolean).sort()[0])}</strong></div><div><small>发车时间</small><strong>未采集，不推断</strong></div><div><small>送完确认</small><strong>${item.deliveryConfirmedAt ? time(item.deliveryConfirmedAt) : '尚未确认送完'}</strong></div><div><small>资料</small><strong>${missing.length ? `待补 ${missing.length} 项` : '照片已收齐'}</strong></div><div><small>已收照片</small><strong>${recordPhotoCount(item)} 张</strong></div></div>
      <details class="admin-missing" ${item.deliveryConfirmedAt && missing.length ? 'open' : ''}><summary>${missing.length ? `待补资料 ${missing.length} 项` : '照片已收齐，待人工核查质量'}${pending.length ? ` · 演示队列 ${pending.length} 张待处理` : ''}</summary><ul>${missing.map(entry => `<li>${escape(entry.label)}${entry.missed ? ' · 当时未拍，历史缺项保留' : ''}</li>`).join('')}</ul></details>
      ${standalone.map(event => `<section class="admin-event"><div class="event-heading"><h3>${eventLabel(event)}</h3><span class="tag neutral">${FIXED.includes(event.type) ? '基础记录' : '旧版事件 · 保留原分组'}</span></div>${tiles(event)}</section>`).join('')}
      ${groups.map(group => `<section class="admin-event"><div class="event-heading"><div><h3>${W.groupLabel(group)}</h3><small>${time(group.createdAt)} · ${groupPhotoCount(item, group)} 张已收${group.kind === 'unload' ? ` · ${outcomeLabel(group.outcome)}` : ''}</small></div><span class="tag neutral">独立现场分组</span></div>
        ${groupEvents(item, group).filter(event => validPhotos(event).length).map(event => `<h4 class="task-caption">${eventLabel(event)}</h4>${tiles(event)}`).join('') || '<p class="muted">本次已记录，尚无已收到的照片。</p>'}${(group.notes || []).map(note => `<div class="notice">${escape(note.text)}<small class="note-author">${escape(note.actor.name)} · ${time(note.at)}</small></div>`).join('')}</section>`).join('')}
      ${!events.length && !groups.length ? '<div class="empty">这趟还没有照片，拍摄者确认车辆后即可采集。</div>' : ''}
      <details class="admin-audit"><summary>确认与纠正记录 · ${item.audit.length} 条</summary>${item.audit.map(entry => `<div class="audit-row"><strong>${({claim_invitation:'领取拍照邀请',issue_continuation:'负责人准备接续邀请',door_finished:'保存本次开关门记录',delivery_confirmed:'全部卸货完毕，完成运输',stop_finished:'本次卸货结束',delivery_corrected:'纠正送完，继续配送'})[entry.type] || entry.type}</strong><small>${time(entry.at)} · ${escape(entry.actor?.name || '未核验')}${entry.reason ? ` · 原因：${escape(entry.reason)}` : ''}${entry.outcome ? ` · ${outcomeLabel(entry.outcome)}` : ''}</small></div>`).join('') || '<p class="muted">还没有送完确认或纠正。</p>'}</details>
      ${!item.deliveryConfirmedAt && groups.some(group => group.kind === 'door') ? `<form id="admin-delivery-form" class="proxy-form"><label for="admin-delivery-reason">负责人核实后代确认（请记录原因）</label><input id="admin-delivery-reason" name="reason" placeholder="例如：已电话核实最后一站全部卸完" required maxlength="100"><button class="secondary full" type="submit">演示：负责人代确认送完</button></form>` : item.deliveryConfirmedAt ? '<button class="secondary" data-action="admin-correct">负责人纠正送完状态</button>' : ''}</div></section>`;
  }
  function image(item, event, photo, watermark) {
    const kind = W.TASKS[event.type]?.[2] || 'cargo';
    const paper = kind === 'paper';
    let scene = paper
      ? `<rect x="68" y="18" width="344" height="258" rx="3" fill="#fffdf1"/><text x="240" y="51" text-anchor="middle" fill="#45504b" font-size="18" font-family="sans-serif">${event.type === 'RECEIPT' ? '货物签收单' : '货物运输单'} · 示例</text>${[78, 101, 124, 147, 170, 193, 216, 239].map(y => `<path d="M90 ${y}H390" stroke="#bbc4b9"/><path d="M170 ${y}v23M302 ${y}v23" stroke="#bbc4b9"/>`).join('')}<text x="95" y="95" fill="#708073" font-size="11">演示内容</text>`
      : `<rect width="480" height="300" fill="#b7c6b0"/><path d="M0 0H480V60H0" fill="#8b9f85"/><path d="M0 300L110 70H370L480 300Z" fill="#d6dfc8"/><path d="M110 70V250M370 70V250M0 60L110 70M480 60L370 70" stroke="#859778" stroke-width="5"/>${[0, 1, 2, 3, 4, 5].map((n) => { const x = 92 + n % 3 * 100, y = 115 + Math.floor(n / 3) * 75; return `<rect x="${x}" y="${y}" width="90" height="68" fill="${(n + photo.scene) % 2 ? '#b99b68' : '#c9ad7c'}" stroke="#968057"/><path d="M${x + 45} ${y}v68" stroke="#e2d0a3" stroke-width="10"/>`; }).join('')}<text x="18" y="29" font-family="sans-serif" fill="#f9fcf6" font-size="14">运输现场 · 示例 ${photo.scene}</text>`;
    if (kind === 'temperature') scene = '<rect width="480" height="300" fill="#d6dfd0"/><rect x="72" y="48" width="336" height="203" rx="18" fill="#40594e"/><rect x="103" y="78" width="274" height="111" rx="8" fill="#cbe0b2"/><text x="240" y="151" text-anchor="middle" font-family="monospace" font-size="52" fill="#30472f">02.0 °C</text><text x="240" y="222" text-anchor="middle" font-family="sans-serif" font-size="17" fill="#fff">温度仪表 · 示例，非实际测量</text>';
    if (kind === 'empty') scene = '<rect width="480" height="300" fill="#a3b69b"/><path d="M0 0L95 45H385L480 0M95 45V210L0 300M385 45V210L480 300M95 210H385" fill="#d9e3ce" stroke="#7d9277" stroke-width="5"/><path d="M120 70H360M120 103H360M120 136H360M120 169H360" stroke="#bdcbb5" stroke-width="3"/><text x="240" y="265" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#334b36">空车厢 · 地面与角落</text>';
    if (kind === 'after') scene = '<rect width="480" height="300" fill="#d5dfc9"/><rect x="18" y="18" width="212" height="264" rx="12" fill="#edf2e5"/><rect x="250" y="18" width="212" height="264" rx="12" fill="#edf2e5"/><text x="124" y="57" text-anchor="middle" font-family="sans-serif" font-size="21" fill="#334b36">中途卸货</text><text x="356" y="57" text-anchor="middle" font-family="sans-serif" font-size="21" fill="#334b36">最后一站</text><rect x="43" y="78" width="162" height="130" fill="#b8c9aa"/><rect x="275" y="78" width="162" height="130" fill="#c5d5b7"/><rect x="62" y="132" width="61" height="60" fill="#c1a471" stroke="#9b855b"/><rect x="126" y="148" width="57" height="44" fill="#cbb081" stroke="#9b855b"/><path d="M290 105H422M290 131H422M290 157H422M290 183H422" stroke="#a6bb95" stroke-width="3"/><text x="124" y="244" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#334b36">拍车厢和剩余货物</text><text x="356" y="244" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#334b36">全部卸完再拍空厢</text>';
    if (kind === 'door') scene = '<rect width="480" height="300" fill="#c6d2be"/><rect x="88" y="22" width="304" height="225" rx="5" fill="#e5eadd" stroke="#7e9178" stroke-width="5"/><path d="M240 22V247M152 48V220M328 48V220" stroke="#9cab91" stroke-width="8"/><rect x="180" y="218" width="120" height="30" rx="3" fill="#2f638a"/><text x="240" y="239" text-anchor="middle" font-family="sans-serif" font-size="17" fill="#fff">示例车牌</text><text x="240" y="281" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#334b36">车门与车牌 · 拍摄示意</text>';
    if (kind === 'site') scene = '<rect width="480" height="300" fill="#d5dfc9"/><rect x="30" y="40" width="230" height="160" fill="#9eb094"/><rect x="70" y="85" width="135" height="115" fill="#526c55"/><rect x="285" y="110" width="160" height="100" fill="#e6eadc"/><path d="M0 240H480" stroke="#a3b697" stroke-width="5"/><circle cx="320" cy="214" r="17" fill="#4c6250"/><circle cx="415" cy="214" r="17" fill="#4c6250"/><text x="240" y="275" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#334b36">卸货位置与周围环境 · 示意</text>';
    const photoGroup = item.groups.find(group => group.id === event.group_id);
    const info = watermark ? `<rect x="0" y="300" width="480" height="100" fill="#223c33"/><text x="17" y="325" font-family="sans-serif" font-size="14" fill="#fff">${escape(item.plate)} · ${photoGroup ? W.groupLabel(photoGroup) + ' · ' : ''}${escape(eventLabel(event))}</text><text x="17" y="351" font-family="sans-serif" font-size="12" fill="#dfebd9">${escape(time(photo.captureTime))} 北京时间 · 演示地点</text><text x="17" y="378" font-family="sans-serif" font-size="12" fill="#dfebd9">${escape(item.no)} · 原型示例水印</text>` : '';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 ${watermark ? 400 : 300}" width="480" height="${watermark ? 400 : 300}">${scene}${info}</svg>`);
  }
  function showPhoto(itemId, selectedEventId, photoId) {
    const item = data.records.find(item => item.id === itemId), event = item.events.find(event => event.id === selectedEventId);
    const photos = (event.group_id ? item.events.filter(other => other.group_id === event.group_id).flatMap(validPhotos) : validPhotos(event))
      .sort((a, b) => (a.captureTime || '').localeCompare(b.captureTime || '') || a.id.localeCompare(b.id));
    viewer = { record: item, event, photos, index: photos.findIndex(photo => photo.id === photoId), original: false };
    if (viewer.index < 0) return;
    viewer.original = photos[viewer.index].status !== 'ready';
    updateViewer(); document.getElementById('photo-dialog').showModal();
  }
  function updateViewer() {
    const photo = viewer.photos[viewer.index], ready = photo.status === 'ready';
    viewer.event = viewer.record.events.find(event => event.id === photo.event_id) || viewer.event;
    if (!ready) viewer.original = true;
    const sceneGroup = viewer.record.groups.find(group => group.id === viewer.event.group_id);
    document.getElementById('photo-title').textContent = `${sceneGroup ? W.groupLabel(sceneGroup) + ' · ' : ''}${eventLabel(viewer.event)} · 照片 ${viewer.index + 1}/${viewer.photos.length}`;
    document.getElementById('photo-display').innerHTML = `<img alt="${viewer.original ? '原图' : '水印图'} · 同一底片的演示图" src="${image(viewer.record, viewer.event, photo, !viewer.original)}">`;
    const group = viewer.record.groups.find(group => group.id === photo.group_id);
    document.getElementById('photo-meta').innerHTML = `${escape(viewer.record.plate)} · ${escape(viewer.record.no)}${group ? ' · ' + W.groupLabel(group) : ''}<br>首次拍摄：${time(photo.captureTime)} · 原图收到（模拟）：${time(photo.receivedAt)}<br>拍摄/上传者：${escape(photo.uploader?.name || '历史身份未核验')} · ${escape(photo.uploader?.role || '未核验')}<br>${escape(photo.location)} · 坐标系 ${escape(photo.coordSystem)} · 精度 ${photo.accuracy == null ? '不可用' : `约 ${photo.accuracy} 米（示例）`}<br>天气：不可用，不能替代温度仪表照片<div class="draft-id">照片请求 ID：${escape(photo.id)}</div>`;
    document.querySelector('[data-action="watermark"]').disabled = !ready;
    document.querySelector('[data-action="watermark"]').setAttribute('aria-pressed', String(!viewer.original));
    document.querySelector('[data-action="original"]').setAttribute('aria-pressed', String(viewer.original));
    document.querySelector('[data-action="previous-photo"]').disabled = viewer.index === 0;
    document.querySelector('[data-action="next-photo"]').disabled = viewer.index === viewer.photos.length - 1;
  }
  document.addEventListener('input', e => { if (e.target.id === 'issue-note' && currentGroup()) { currentGroup().noteDraft = e.target.value; save(); } });
  document.addEventListener('submit', e => {
    if (e.target.id === 'issue-note-form') {
      e.preventDefault();
      try { W.saveIssueNote(record(), currentGroup(), new FormData(e.target).get('note'), data.actor); currentGroup().noteDraft = ''; save(); render(); toast('问题说明已保存在本趟'); } catch (error) { toast(error.message); }
      return;
    }
    if (e.target.id === 'prepare-form') {
      e.preventDefault();
      try {
        const result = W.prepare(data, Object.fromEntries(new FormData(e.target)));
        invitationPanel = result.invite.id; view = 'home'; save(); render();
      } catch (error) { toast(error.message); }
    }
    if (e.target.id === 'correction-form') {
      e.preventDefault();
      try {
        W.correctDelivery(record(), data.actor, new FormData(e.target).get('reason'));
        view = 'record'; save(); render(); toast('已纠正为继续配送，原来的确认记录已保留');
      } catch (error) { toast(error.message); }
    }
    if (e.target.id === 'admin-delivery-form') {
      e.preventDefault();
      const reason = String(new FormData(e.target).get('reason') || '').trim();
      const item = data.records.find(item => item.id === adminRecordId);
      if (!reason) return toast('请填写代确认原因');
      if (W.completionBlocker(item)) return toast(W.completionBlocker(item));
      ask('负责人已核实整车送完？', '此操作会以“演示负责人”记录代确认及原因，不会冒充司机本人操作。', () => {
        try {
          W.completeTransport(item, { id: 'admin-demo', name: '演示负责人', role: '总部' }, reason); save(); render();
        } catch (error) { toast(error.message); }
      }, '已核实，代确认', '取消');
    }
    if (e.target.id === 'filter-form') {
      e.preventDefault(); const values = new FormData(e.target);
      if (values.get('start') && values.get('end') && values.get('start') > values.get('end')) return toast('结束日期不能早于开始日期');
      filter = Object.fromEntries(values); page = 1; render();
    }
  });
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const { action, id, type } = button.dataset;
    try {
    if (action === 'driver' || action === 'admin') {
      if (view === 'camera') return toast('请先使用或放弃当前照片，再切换使用端');
      const switchMode = () => {
        if (currentGroup()) W.cancelEmptyGroup(record(), currentGroup());
        groupId = null; eventId = null; mode = action; view = 'home'; adminRecordId = null; invitationPanel = null; save(); render();
      };
      if (mode === 'driver' && inviteId && W.pending(record()).some(entry => ['queued', 'failed'].includes(entry.photo.status))) {
        ask('有照片尚未上传', '照片会保留在原趟、原次现场，切换后仍能回来重试。', switchMode, '保留并切换', '继续处理');
      } else switchMode();
    } else if (action === 'home') {
      // Keep this trip's invitation when returning home.
      view = 'home'; render();
    }
    else if (action === 'wrong-plate') { view = 'wrong-plate'; render(); }
    else if (action === 'door-open' || action === 'door-close') {
      const group = action === 'door-open' ? W.startGroup(record(), 'door') : record().groups.find(group => group.kind === 'door' && !group.completedAt);
      if (!group) return toast('请先拍本次开门照片');
      openGroup(group); selectTask(action === 'door-open' ? 0 : 1);
    } else if (action === 'complete-transport') {
      const blocker = W.completionBlocker(record());
      if (blocker) return toast(blocker);
      ask('所有货物都卸完了吗？', '确认本趟已全部卸货，没有下一站要送，且每次开关门照片均已保存。', () => { W.completeTransport(record(), data.actor); save(); view = 'record'; render(); }, '确认，完成运输', '还要继续运输');
    }
    else if (action === 'record') { view = 'record'; groupId = null; eventId = null; render(); }
    else if (action === 'open-invite') openInvite(id);
    else if (action === 'claim-invite') {
      const access = W.inviteAccess(data, inviteId, data.actor, true); save(); enterRecord(access.record);
    } else if (action === 'simulate-invite') {
      data.actor = { ...(button.dataset.actor === W.HELPER.id ? W.HELPER : W.DRIVER) };
      document.getElementById('demo-actor').value = data.actor.id; save(); openInvite(id);
    } else if (action === 'loading' || action === 'materials' || action === 'queue' || action === 'correction') {
      view = action; groupId = null; eventId = null; render();
    } else if (action === 'start-group' || action === 'issue') openGroup(W.startGroup(record(), action === 'issue' ? 'issue' : button.dataset.kind));
    else if (action === 'open-group') openGroup(record().groups.find(group => group.id === id));
    else if (action === 'select-task') selectTask(Number(button.dataset.index));
    else if (action === 'next-task') {
      if (taskIndex < W.GROUPS[currentGroup().kind].types.length - 1) selectTask(taskIndex + 1);
      else finishGroup();
    } else if (action === 'finish-group') finishGroup();
    else if (action === 'leave-group') leaveGroup();
    else if (action === 'back-group') { view = 'group'; render(); }

    else if (action === 'go-missing') goMissing(button);
    else if (action === 'open-pending') {
      const entry = W.pending(record()).find(entry => entry.photo.id === id);
      if (!entry) return toast('这张已处理，可以从现场记录查看');
      if (entry.group) {
        groupId = entry.group.id; taskIndex = W.GROUPS[entry.group.kind].types.indexOf(entry.event.type); eventId = entry.event.id; view = 'group';
      } else { groupId = null; eventId = entry.event.id; view = 'event'; }
      render();
    } else if (action === 'missed') {
      const group = currentGroup(), taskType = W.GROUPS[group.kind].types[taskIndex];
      ask('这项现场当时没有拍到？', '会如实记录“当时未拍”。之后补拍保留实际时间，不会伪造过去的现场。', () => {
        W.markMissed(record(), taskType, group, data.actor); save(); render();
      }, '记录当时未拍', '返回拍照');
    } else if (action === 'next-base') begin(FIXED[FIXED.indexOf(currentEvent().type) + 1]);
    else if (action === 'begin') begin(type);
    else if (action === 'open-event') { groupId = null; eventId = id; view = 'event'; render(); }
    else if (action === 'leave-event') leaveEvent();
    else if (action === 'capture' || action === 'retake') newCapture();
    else if (action === 'cancel-capture') ask('放弃这张照片？', '这张尚未使用，放弃后需要重新拍摄。其他已保存的照片会保留。', () => { capture = null; view = currentGroup() ? 'group' : 'event'; render(); }, '放弃这张', '继续使用');
    else if (action === 'use-photo') {
      if (!capture) return;
      const owner = data.records.find(item => item.id === capture.record_id), event = owner.events.find(event => event.id === capture.event_id);
      capture.failUpload = document.getElementById('fail-upload').checked;
      capture.failWatermark = document.getElementById('fail-watermark').checked;
      const keepLocal = document.getElementById('keep-local').checked;
      const photo = W.attachPhoto(owner, event, capture, data.actor);
      capture = null; view = currentGroup() ? 'group' : 'event'; save();
      if (keepLocal) { render(); toast('照片先留在本机演示队列，所属运输和现场已固定'); }
      else upload(photo);
    } else if (action === 'retry' || action === 'retry-watermark') upload(currentEvent().photos.find(photo => photo.id === id), action === 'retry-watermark');
    else if (action === 'remove') removePhoto(id, button.dataset.event);
    else if (action === 'submit') submit();
    else if (action === 'admin-detail') { adminRecordId = id; render(); }
    else if (action === 'prepare') { view = 'prepare'; invitationPanel = null; render(); }
    else if (action === 'admin-back') { adminRecordId = null; invitationPanel = null; view = 'home'; render(); }
    else if (action === 'continuation') {
      const item = data.records.find(item => item.id === adminRecordId), invite = W.continuation(data, item, W.HELPER);
      invitationPanel = invite.id; save(); render();
    } else if (action === 'admin-correct') {
      const item = data.records.find(item => item.id === adminRecordId);
      ask('负责人纠正为继续配送', '保留之前送完确认，填写核实后的纠正原因。照片仍归属原趟。', reason => {
        W.correctDelivery(item, { id: 'admin-demo', name: '演示负责人', role: '总部' }, reason); save(); render();
      }, '记录纠正', '取消', true);
    }
    else if (action === 'clear-filter') { filter = { query: '', start: '', end: '', status: '' }; page = 1; render(); }
    else if (action === 'page-prev' || action === 'page-next') { page += action === 'page-prev' ? -1 : 1; render(); }
    else if (action === 'view-photo') showPhoto(button.dataset.record, button.dataset.event, id);
    else if (action === 'original' || action === 'watermark') { viewer.original = action === 'original'; updateViewer(); }
    else if (action === 'previous-photo' || action === 'next-photo') { viewer.index += action === 'previous-photo' ? -1 : 1; updateViewer(); }
    else if (action === 'close-photo') document.getElementById('photo-dialog').close();
    else if (action === 'large') { largeText = !largeText; render(); window.scrollTo(0, 0); }
    else if (action === 'mute') { muted = !muted; if (muted) window.speechSynthesis?.cancel(); render(); }
    else if (action === 'listen') {
      const hint = app.querySelector('.capture-hint')?.textContent || '先核对车牌。运输前依次拍货运单、货物码放、装好的车厢并提交。途中每次开门和关门都要拍。问题随时反馈，全部卸货后确认完成运输。';
      if (muted) return toast('当前已静音，点“开启语音”后可听提示');
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return ask('拍摄提示', hint, () => {}, '知道了', '返回');
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(hint); utterance.lang = 'zh-CN'; utterance.rate = 0.85;
      utterance.onerror = () => toast('当前浏览器无法朗读，请看屏幕提示');
      window.speechSynthesis.speak(utterance);
      toast('原型使用浏览器朗读演示，正式版本可换预录语音');
    } else if (action === 'contact') ask('联系发入口的负责人', '请在收到拍照入口的微信会话中联系发入口的人。本页只演示联系提示，未拨号、未发送消息，也没有保存真实联系方式。', () => {}, '我知道了', '返回');
    else if (action === 'reset') ask('重置演示进度？', '只清除本页的演示进度，恢复一份空档案和一份多事件档案。', () => {
      data = W.normalize(initialState()); mode = 'driver'; view = 'home'; eventId = null; groupId = null; capture = null; adminRecordId = null; invitationPanel = null; save(); render();
    }, '重置演示', '取消');
    } catch (error) { toast(error.message || '这一步暂时无法完成，请返回重试'); }
  });
  document.getElementById('confirm-no').addEventListener('click', () => { confirmAction = null; document.getElementById('confirm-dialog').close(); });
  document.getElementById('confirm-yes').addEventListener('click', () => {
    const reason = document.getElementById('confirm-reason').value.trim();
    if (confirmNeedsReason && !reason) { document.getElementById('confirm-reason').focus(); return; }
    const action = confirmAction; confirmAction = null; document.getElementById('confirm-dialog').close();
    try { action?.(reason); } catch (error) { toast(error.message); }
  });
  document.getElementById('confirm-dialog').addEventListener('cancel', () => { confirmAction = null; });
  window.addEventListener('beforeunload', e => { if (view === 'camera') { e.preventDefault(); e.returnValue = ''; } });
  document.getElementById('demo-actor').value = data.actor.id;
  document.getElementById('demo-actor').addEventListener('change', e => {
    if (view === 'camera') { e.target.value = data.actor.id; return toast('请先使用或放弃当前照片，再切换身份'); }
    data.actor = { ...(e.target.value === W.HELPER.id ? W.HELPER : W.DRIVER) };
    mode = 'driver'; view = 'home'; groupId = null; eventId = null; save(); render();
  });
  save();
  const incomingInvite = new URLSearchParams(location.search).get('invite');
  if (incomingInvite) openInvite(incomingInvite); else render();
})();
