// Standalone test client. The generated target contains a TEST trip invitation,
// never an administrator token. This is not the production driver page.
const target = require('../../target');
const DRAFT = 'transport_v1_invitation_probe_claim';
const call = async input => {
  const { result } = await wx.cloud.callFunction({ name: 'transportV1', data: input });
  if (!result || !result.success) {
    const error = new Error(result && result.message || '暂时未能连接，请重试');
    error.code = result && result.code || 'NETWORK';
    throw error;
  }
  return result.data;
};
Page({
  data: { record: null, busy: false, claimed: false, mismatch: false, error: '', message: '', readVerified: false },
  onLoad() { this.load(); },
  async load() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const result = await call({ action: 'preview', invite: target.invite });
      this.setData({ record: result.record, claimed: result.claimed,
        message: result.claimed ? '已接续本趟运输，无需重复确认。' : '' });
    } catch (error) { this.setData({ error: error.message || '网络未连接，请重试' }); }
    finally { this.setData({ busy: false }); }
  },
  mismatch() { this.setData({ mismatch: true, message: '', error: '' }); },
  back() { this.setData({ mismatch: false }); },
  async confirm() {
    if (this.data.busy || this.data.claimed || !this.data.record || this.data.mismatch) return;
    this.setData({ busy: true, error: '' });
    try {
      let draft = wx.getStorageSync(DRAFT);
      if (!draft || draft.invite !== target.invite) {
        draft = { invite: target.invite, requestId: `claim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}` };
        // Persist before the call, so a lost response does not cause a second action.
        wx.setStorageSync(DRAFT, draft);
      }
      const result = await call({ action: 'claim', invite: target.invite, request_id: draft.requestId,
        confirm_plate: this.data.record.plate_number });
      this.setData({ record: result.record, claimed: true, message: '本趟车牌已确认，可以继续本趟运输。' });
    } catch (error) { this.setData({ error: error.message || '网络中断，请重试，仍使用本次确认请求' }); }
    finally { this.setData({ busy: false }); }
  },
  async read() {
    if (this.data.busy || !this.data.claimed) return;
    this.setData({ busy: true, error: '' });
    try {
      const result = await call({ action: 'get', record_id: this.data.record.id });
      if (result.record.id !== target.record_id) throw new Error('返回的运输不一致，请联系负责人');
      this.setData({ record: result.record, readVerified: true, message: '读取成功，仍然是同一趟运输。' });
    } catch (error) { this.setData({ error: error.message || '网络中断，请重试' }); }
    finally { this.setData({ busy: false }); }
  },
});
