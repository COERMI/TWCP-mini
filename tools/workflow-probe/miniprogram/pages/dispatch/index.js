// Administrator credentials and invitations stay in page memory, never in shared paths.
const api = require('../../lib/transport');
Page({
  data: { username: '', password: '', loggedIn: false, busy: false, error: '', rows: [], selected: null, keyword: '', page: 1, hasMore: false },
  onLoad() { wx.hideShareMenu(); },
  field(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  async login() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const { result } = await wx.cloud.callFunction({ name: 'adminLogin',
        data: { username: this.data.username, password: this.data.password } });
      if (!result || !result.success) throw new Error(result && result.message || '登录失败');
      this.token = result.data.token;
      this.setData({ password: '', loggedIn: true });
    } catch (error) { this.setData({ password: '', error: error.message || '连接失败，请重试' }); }
    finally { this.setData({ busy: false }); }
    if (this.token) await this.search();
  },
  async search(event) {
    if (this.data.busy || !this.token) return;
    const next = event && event.currentTarget.dataset.next;
    const page = next ? this.data.page + 1 : 1;
    this.selection = null;
    this.setData({ busy: true, error: '', selected: null });
    try {
      const data = await api.call({ action: 'adminList', token: this.token, source: 'v1',
        phase: 'awaiting_plate', keyword: this.data.keyword.trim(), page, pageSize: 20 });
      this.setData({ rows: data.list.filter(r => !r.invite_revoked_at), page,
        hasMore: page * data.pageSize < data.total });
    } catch (error) { this.setData({ rows: [], error: error.message || '读取失败，请重试' }); }
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
    } catch (error) { this.selection = null; this.setData({ error: error.message || '入口不可用，请刷新' }); }
    finally { this.setData({ busy: false }); }
  },
  onShareAppMessage() {
    const s = this.selection;
    if (!s || !this.token || s.expires <= Date.now()) {
      return { title: '运输照片采集', path: '/pages/entry/index', imageUrl: '/assets/share-card.png' };
    }
    return { title: `${s.record.plate_number} · ${s.record.ship_date} 本趟运输`,
      path: '/pages/entry/index?invite=' + encodeURIComponent(s.invite), imageUrl: '/assets/share-card.png' };
  },
  logout() {
    this.token = null; this.selection = null;
    this.setData({ loggedIn: false, password: '', selected: null, rows: [], error: '' });
  },
  onUnload() { this.token = null; this.selection = null; },
});
