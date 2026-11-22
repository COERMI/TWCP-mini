<template>
  <el-button type="primary" @click="openCreate">＋ 新建本趟运输</el-button>
  <el-dialog v-model="visible" :title="mode === 'invitation' ? '本趟司机入口' : result ? '本趟运输已创建' : '新建本趟运输'" width="min(580px,94vw)" :close-on-click-modal="false" :close-on-press-escape="!working" :show-close="!working" @closed="clearResult">
    <template v-if="result">
      <div class="dispatch-plate">{{result.record.plate_number}}</div>
      <p>{{result.record.record_no}} · {{result.record.ship_date}}</p>
      <p class="direction">{{result.record.description}}</p>
      <el-alert title="请先核对车牌，再把本趟入口交给对应司机。" type="success" :closable="false" />
      <p>首次确认有效期至 {{formatDateTime(result.invite_expires_at)}}（北京时间）。司机确认后，原入口可接续本趟。</p>
      <el-alert v-if="localReview" title="当前为微信测试预览，仅供有权限的测试人员扫码，尚未发布给正式司机。" type="warning" :closable="false" />
      <el-alert v-else title="正式司机入口正在接入，请先保存本趟档案。" type="info" :closable="false" />
      <div class="qr-wrap" v-if="qr"><img :src="qr" alt="本趟运输测试预览二维码" /><p>仅本趟 · 请用微信扫码核对车牌</p></div>
      <div class="dispatch-actions">
        <el-button v-if="localReview" type="primary" :loading="generating" :disabled="revoking" @click="generate">{{qr ? '重新生成测试二维码' : '生成本趟测试二维码'}}</el-button>
        <el-button :disabled="working" @click="showRecord">查看本趟档案</el-button>
        <el-button type="danger" plain :loading="revoking" :disabled="generating" @click="revoke">车牌发错，停用此入口</el-button>
      </div>
    </template>
    <p v-else-if="mode === 'invitation'">正在读取本趟入口，请稍候…</p>
    <template v-else>
      <p>每次运输单独建档；同一车牌再次运输，也创建新的一趟。</p>
      <el-alert v-if="draft.submitted && !busy" title="上次创建结果尚未确认。请用原内容重试，系统会返回同一趟。" type="warning" :closable="false" />
      <el-form label-position="top" @submit.prevent="create">
        <el-form-item label="本趟车牌"><el-input v-model="draft.plate_number" maxlength="8" placeholder="例如：粤B12345" :disabled="draft.submitted || busy" /></el-form-item>
        <el-form-item label="发货日期"><el-date-picker v-model="draft.ship_date" type="date" value-format="YYYY-MM-DD" :clearable="false" :disabled="draft.submitted || busy" /></el-form-item>
        <el-form-item label="装货地 / 目的地方向"><el-input v-model="draft.description" maxlength="120" placeholder="例如：昆明基地 → 广州" :disabled="draft.submitted || busy" /></el-form-item>
        <el-form-item label="批次（选填）"><el-input v-model="draft.batch" maxlength="60" :disabled="draft.submitted || busy" /></el-form-item>
        <el-button native-type="submit" type="primary" :loading="busy">{{busy ? '正在创建本趟…' : draft.submitted ? '用原请求重试创建' : '确认车牌，创建本趟'}}</el-button>
      </el-form>
    </template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
  </el-dialog>
</template>
<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { prepareTrip, getInvitation, revokeInvitation, previewInvitation } from '../api/admin';
import { clearToken, formatDateTime } from '../utils/auth';
import { newDraft, readDraft, saveDraft, clearDraft, preparePayload, validateDraft } from '../utils/dispatch';
const props = defineProps({ localReview: Boolean });
const emit = defineEmits(['created']);
const router = useRouter(), visible = ref(false), busy = ref(false), error = ref(''), result = ref(null);
const qr = ref(''), generating = ref(false), revoking = ref(false);
const mode = ref('create');
const working = computed(() => busy.value || generating.value || revoking.value);
const draft = reactive(readDraft() || newDraft());
watch(draft, value => { if (!value.submitted) { try { saveDraft(value); } catch {} } }, { deep: true });
function clearResult() { result.value = null; qr.value = ''; error.value = ''; }
function openCreate() { if (working.value) return; clearResult(); mode.value = 'create'; visible.value = true; }
function check(response) {
  if (response?.code === 'FORBIDDEN') { clearToken(); router.replace('/login'); }
  if (!response?.success) throw Object.assign(new Error(response?.message || '处理未完成，请重试'), { code: response?.code });
  return response.data;
}
async function create() {
  if (busy.value) return;
  const invalid = validateDraft(draft);
  if (invalid) { error.value = invalid; return; }
  busy.value = true; error.value = '';
  try {
    Object.assign(draft, preparePayload(draft), { submitted: true });
    try { saveDraft(draft); }
    catch { draft.submitted = false; throw new Error('浏览器未能保存本次创建请求。请允许本站本地存储后重试，尚未发送创建请求'); }
    result.value = check(await prepareTrip(preparePayload(draft)));
    clearDraft(); Object.assign(draft, newDraft());
    emit('created', result.value.record);
  } catch(e) {
    // A business validation rejection means nothing was created. Network and
    // unknown errors keep the exact payload locked for a safe idempotent retry.
    if (['INVALID_PLATE','INVALID_DATE','INVALID_INPUT'].includes(e.code)) draft.submitted = false;
    error.value = e.message || '创建结果未收到，请用原请求重试';
  } finally { busy.value = false; }
}
async function openInvitation(record) {
  if (working.value) return;
  clearResult(); mode.value = 'invitation'; visible.value = true; busy.value = true;
  try { result.value = check(await getInvitation(record.id)); }
  catch(e) { error.value = e.message; visible.value = false; throw e; }
  finally { busy.value = false; }
}
async function generate() {
  if (generating.value || !result.value) return;
  generating.value = true; error.value = ''; qr.value = '';
  try { qr.value = check(await previewInvitation(result.value.record.id)).qr; }
  catch(e) { error.value = e.message || '测试二维码暂未生成，档案已保留，可稍后重新生成'; }
  finally { generating.value = false; }
}
async function revoke() {
  try { await ElMessageBox.confirm('停用后，未确认的司机不能再使用此入口。档案会保留；请用正确车牌新建本趟运输。', '停用发错的入口', { confirmButtonText: '停用此入口', cancelButtonText: '返回核对', type: 'warning' }); }
  catch { return; }
  revoking.value = true; error.value = '';
  try { check(await revokeInvitation(result.value.invite)); visible.value = false; emit('created'); }
  catch(e) { error.value = e.message; }
  finally { revoking.value = false; }
}
function showRecord() { const id = result.value.record.id; visible.value = false; router.push({path:'/record/' + id, query:{source:'v1'}}); }
defineExpose({ openInvitation });
</script>
<style scoped>
.dispatch-plate{font-size:32px;font-weight:700;color:#214c34}.direction{white-space:pre-wrap;overflow-wrap:anywhere}.dispatch-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}.dispatch-actions .el-button{margin-left:0}.el-alert{margin:16px 0}.qr-wrap{text-align:center;margin:24px 0}.qr-wrap img{width:240px;max-width:100%;height:auto}.qr-wrap p{font-size:13px;color:#617367}
</style>
