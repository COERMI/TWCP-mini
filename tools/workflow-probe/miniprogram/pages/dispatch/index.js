// Passwords stay in memory; expiring administrator sessions are local, never shared.
const api = require('../../lib/transport');
const SESSION = 'v1_admin_session';
const DRAFT = 'v1_admin_create_draft';
const phases = { awaiting_plate: '待确认车牌', preparing: '运输前拍照', transporting: '运输中', completed: '已完成' };
const beijingDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
Page({
  data: { username: '', password: '', loggedIn: false, busy: false, error: '', rows: [], selected: null, keyword: '', page: 1, hasMore: false, phase: '', sort: 'updated_desc', showCreate: false,
    plate_number: '', ship_date: '', description: '', batch: '', createLocked: false },
  onLoad() {
    wx.hideShareMenu();
    this.setData({ ship_date: beijingDate() });
    const session = wx.getStorageSync(SESSION);
    if (session && session.expires > Date.now()) {
      this.token = session.token; this.setData({ loggedIn: true }); this.search();
    } else wx.removeStorageSync(SESSION);
    const draft = wx.getStorageSync(DRAFT);
    if (draft) { this.createDraft = draft; this.setData({ ...draft.payload, showCreate: true, createLocked: true }); }
  },
  toggleCreate() { this.setData({ showCreate: !this.data.showCreate }); },
  filter(event) { this.setData({ [event.currentTarget.dataset.field]: event.currentTarget.dataset.value }); this.search(); },
  fail(error) {
    if (error.code === 'FORBIDDEN') { this.logout(); this.setData({ error: '登录已过期，请重新登录。' }); }
    else this.setData({ error: error.message || '连接失败，请重试' });
  },
  async create() {
    if (this.data.busy || !this.token) return;
    if (!this.createDraft) {
      const payload = { plate_number: this.data.plate_number.trim().toUpperCase(), ship_date: this.data.ship_date,
        description: this.data.description.trim(), batch: this.data.batch.trim() };
      if (!payload.plate_number || !payload.ship_date || !payload.description) {
        this.setData({ error: '请填写车牌、发货日期和运输说明。' }); return;
      }
      this.createDraft = { payload, request_id: api.requestId() };
      wx.setStorageSync(DRAFT, this.createDraft);
    }
    this.setData({ busy: true, error: '', createLocked: true, selected: null }); this.selection = null;
    let created;
    try {
      created = await api.call({ action: 'prepare', token: this.token, ...this.createDraft.payload, request_id: this.createDraft.request_id });
      wx.removeStorageSync(DRAFT); this.createDraft = null;
      this.setData({ createLocked: false, showCreate: false, plate_number: '', description: '', batch: '',
        keyword: created.record.record_no, phase: '' });
    } catch (error) {
      if (['INVALID_PLATE', 'INVALID_DATE', 'INVALID_INPUT'].includes(error.code)) {
        wx.removeStorageSync(DRAFT); this.createDraft = null; this.setData({ createLocked: false });
      }
      this.fail(error);
    } finally { this.setData({ busy: false }); }
    if (created) { await this.search(); await this.select({ currentTarget: { dataset: { id: created.record.id } } }); }
  },
  field(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  async login() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const { result } = await wx.cloud.callFunction({ name: 'adminLogin',
        data: { username: this.data.username, password: this.data.password } });
      if (!result || !result.success) throw new Error(result && result.message || '登录失败');
      this.token = result.data.token;
      wx.setStorageSync(SESSION, { token: this.token, expires: result.data.expires_at });
      this.setData({ password: '', loggedIn: true });
    } catch (error) { this.setData({ password: '', error: error.message || '连接失败，请重试' }); }
    finally { this.setData({ busy: false }); }
    if (this.token) await this.search();
  },
  async search(event) {
    if (this.data.busy || !this.token) return;
    const next = event && event.currentTarget.dataset.next;
    const previous = event && event.currentTarget.dataset.previous;
    const page = next ? this.data.page + 1 : previous ? Math.max(1, this.data.page - 1) : 1;
    this.selection = null;
    this.setData({ busy: true, error: '', selected: null });
    try {
      const data = await api.call({ action: 'adminList', token: this.token, source: 'v1',
        phase: this.data.phase, sort: this.data.sort, keyword: this.data.keyword.trim(), page, pageSize: 20 });
      this.setData({ rows: data.list.map(r => ({ ...r, phaseText: r.invite_revoked_at ? '入口已停用' : phases[r.phase] || r.phase })), page,
        hasMore: page * data.pageSize < data.total });
    } catch (error) { this.setData({ rows: [] }); this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  async select(event) {
    if (this.data.busy) return;
    this.selection = null;
    this.setData({ busy: true, selected: null, error: '' });
    try {
      const record = this.data.rows.find(r => r.id === event.currentTarget.dataset.id);
      if (!record) throw new Error('请重新选择本趟运输');
      const data = await api.call({ action: 'adminInvite', token: this.token, record_id: record.id });
      this.selection = { record, invite: data.invite, expires: data.invite_expires_at };
      this.setData({ selected: { plate: record.plate_number, date: record.ship_date, description: record.description } });
    } catch (error) { this.selection = null; this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  onShareAppMessage(event) {
    if (event && event.target && event.target.dataset.kind === 'admin') {
      return { title: '运输管理 · 新增、查询、发给司机', path: '/pages/dispatch/index', imageUrl: '/assets/share-card.png' };
    }
    const s = this.selection;
    if (!s || !this.token || s.expires <= Date.now()) {
      return { title: '运输照片采集', path: '/pages/entry/index', imageUrl: '/assets/share-card.png' };
    }
    return { title: `${s.record.plate_number} · ${s.record.ship_date} 本趟运输`,
      path: '/pages/entry/index?invite=' + encodeURIComponent(s.invite), imageUrl: '/assets/share-card.png' };
  },
  logout() {
    this.token = null; this.selection = null; wx.removeStorageSync(SESSION);
    this.setData({ loggedIn: false, password: '', selected: null, rows: [], error: '' });
  },
  onUnload() { this.token = null; this.selection = null; },
});
