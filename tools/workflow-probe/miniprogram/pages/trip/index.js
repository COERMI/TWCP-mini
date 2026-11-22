const api = require('../../lib/transport');
const { createQueue } = require('../../lib/photo-queue');
const { view, LABELS } = require('../../lib/view');
const modal = options => wx.showModal(options);
Page({
  data: { record: null, state: null, busy: false, error: '', notice: '', note: '', pending: [], base: [], doors: [], issues: [] },
  onLoad(options) {
    this.recordId = options.record;
    this.queue = createQueue({ platform: wx, call: api.call, requestId: api.requestId, recordId: this.recordId });
    const cache = wx.getStorageSync('v1_snapshot_' + this.recordId);
    if (cache) {
      this.current = cache.state;
      this.setData({ record: cache.record, ...view(cache.state, this.queue.list()),
        notice: '已恢复上次查看的记录，正在核对云端状态。' });
    } else {
      this.setData({ pending: this.queue.list().map(d => ({ ...d, label: LABELS[d.type], statusText: '待恢复上传' })) });
    }
    this.refresh();
  },
  onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()); },
  async refresh() {
    if (this.data.busy || !this.queue) return;
    return this.run(async () => {
      const record = await api.call({ action: 'get', record_id: this.recordId });
      this.setData({ record: record.record }); await this.reload();
    });
  },
  async reload() {
    const state = await api.snapshot(this.recordId);
    this.current = state;
    wx.setStorageSync('v1_snapshot_' + this.recordId, { state, record: this.data.record });
    this.setData(view(state, this.queue.list()));
  },
  async run(work) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try { await work(); }
    catch (error) { this.setData({ error: error.message || '连接未完成，照片保留在本机，请重试' }); }
    finally {
      if (this.current) this.setData(view(this.current, this.queue.list()));
      this.setData({ busy: false });
    }
  },
  async shoot(event) {
    const { type, event: eventId } = event.currentTarget.dataset;
    if (this.data.busy || this.data.done) return;
    return this.run(async () => {
      let group = this.current.events.find(e => e.id === eventId);
      if (!group) {
        const kind = type === 'ISSUE' ? 'issue' : 'base';
        group = (await api.mutate(this.recordId, 'startEvent', {
          kind, type: kind === 'base' ? type : '', note: kind === 'issue' ? this.data.note.trim() : '',
        })).event;
        if (kind === 'issue') this.setData({ note: '' });
        // Persist successful event creation in the UI before opening the camera.
        await this.reload();
      }
      let captured;
      try {
        captured = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera'], sizeType: ['original'] });
      } catch (error) {
        if (String(error.errMsg).includes('cancel')) return;
        throw new Error('相机未打开，请检查相机权限后再拍');
      }
      const draft = await this.queue.add(captured.tempFiles[0], group, type, Date.now());
      this.setData({ notice: '照片已保存在手机，正在上传归档…' });
      const photo = await this.queue.send(draft.id);
      this.setData({ notice: photo && photo.status === 'ready' ? `${LABELS[type]}已归档` : '照片仍在处理，可稍后重试' });
      await this.reload();
    });
  },
  async retry(event) {
    return this.run(async () => {
      await this.queue.send(event.currentTarget.dataset.id);
      await this.reload();
    });
  },
  async retryRemote(event) {
    return this.run(async () => {
      const photo = this.current.photos.find(p => p.id === event.currentTarget.dataset.id);
      const local = this.queue.list().find(d => d.photo_id === photo.id);
      if (local) await this.queue.send(local.id);
      else if (photo.original_bytes) await api.call({ action: 'processPhoto', record_id: this.recordId, photo_id: photo.id });
      else throw new Error('原图尚未归档，请在原拍摄手机上补传；若原文件已丢失，请移除这张待传记录后重拍');
      await this.reload();
    });
  },
  async reason(title) {
    const answer = await modal({ title, editable: true, placeholderText: '请填写原因（必填）', confirmText: '确认' });
    if (!answer.confirm) return null;
    const reason = (answer.content || '').trim();
    if (!reason) throw new Error('请填写原因后再操作');
    return reason;
  },
  async discard(event) {
    return this.run(async () => {
      const reason = await this.reason('移除这张待处理照片');
      if (!reason) return;
      await this.queue.discard(event.currentTarget.dataset.id, reason);
      await this.reload();
    });
  },
  async remove(event) {
    return this.run(async () => {
      const reason = await this.reason('移除照片并保留纠正记录');
      if (!reason) return;
      const id = event.currentTarget.dataset.id;
      const local = this.queue.list().find(d => d.photo_id === id);
      if (local) await this.queue.discard(local.id, reason);
      else await api.mutate(this.recordId, 'removePhoto', { photo_id: id, reason });
      await this.reload();
    });
  },
  async preview(event) {
    return this.run(async () => {
      const { id, kind } = event.currentTarget.dataset;
      const links = await api.call({ action: 'photoLinks', record_id: this.recordId, photo_id: id });
      const url = kind === 'original' ? links.original_url : links.watermarked_url;
      if (!url) throw new Error('这张图片尚未就绪，请稍后刷新');
      await wx.previewImage({ urls: [url] });
    });
  },
  async depart() {
    return this.run(async () => {
      if (this.queue.list().length) throw new Error('手机还有照片待上传，请先处理');
      const answer = await modal({ title: '提交运输前三项照片', content: '确认货运单、货物码放、装好的车厢都已拍齐。提交后，每次开关门还要继续拍照。', confirmText: '确认提交' });
      if (!answer.confirm) return;
      await api.mutate(this.recordId, 'submitBase'); await this.reload();
    });
  },
  async startDoor() {
    return this.run(async () => { await api.mutate(this.recordId, 'startEvent', { kind: 'door' }); await this.reload(); });
  },
  async finishDoor(event) {
    return this.run(async () => {
      const event_id = event.currentTarget.dataset.event;
      if (this.queue.list().some(d => d.event_id === event_id)) throw new Error('本次还有照片待上传');
      await api.mutate(this.recordId, 'finishDoor', { event_id }); await this.reload();
      this.setData({ notice: '本次开关门已保存，运输仍在继续。' });
    });
  },
  async cancelDoor(event) {
    return this.run(async () => {
      const event_id = event.currentTarget.dataset.event;
      if (this.queue.list().some(d => d.event_id === event_id)) throw new Error('本机还有本次照片，请先上传或移除');
      const answer = await modal({ title: '取消这次空记录', content: '仅适用于误点且尚未拍照的记录。', confirmText: '取消记录' });
      if (!answer.confirm) return;
      await api.mutate(this.recordId, 'cancelDoor', { event_id }); await this.reload();
    });
  },
  noteInput(event) { this.setData({ note: event.detail.value }); },
  async saveIssue() {
    return this.run(async () => {
      const note = this.data.note.trim();
      if (!note) throw new Error('请先填写问题说明，也可以直接拍问题照片');
      await api.mutate(this.recordId, 'startEvent', { kind: 'issue', note });
      this.setData({ note: '', notice: '问题说明已保存。' }); await this.reload();
    });
  },
  async editIssue(event) {
    return this.run(async () => {
      const group = this.current.events.find(e => e.id === event.currentTarget.dataset.event);
      const answer = await modal({ title: '补充问题说明', editable: true, content: group.note, placeholderText: '填写问题说明', confirmText: '保存' });
      if (!answer.confirm) return;
      await api.mutate(this.recordId, 'saveIssue', { event_id: group.id, note: answer.content });
      await this.reload();
    });
  },
  async complete() {
    return this.run(async () => {
      if (this.queue.list().length) throw new Error('手机还有照片待上传，请先处理');
      const answer = await modal({ title: '全部卸货完毕？', content: '请确认所有货物均已卸完，最后一次开门和关门照片也已保存。确认后，本趟运输结束。', confirmText: '确认完成' });
      if (!answer.confirm) return;
      await api.mutate(this.recordId, 'completeTrip', { confirm_all_unloaded: true }); await this.reload();
      this.setData({ notice: '本趟运输已完成。' });
    });
  },
  async reopen() {
    return this.run(async () => {
      const reason = await this.reason('纠正完成状态');
      if (!reason) return;
      await api.mutate(this.recordId, 'reopenTrip', { reason }); await this.reload();
      this.setData({ notice: '已恢复运输中，请补充本趟记录。' });
    });
  },
});
