<template>
  <main class="page">
    <header class="heading"><el-button @click="back">← 返回记录列表</el-button><el-button :loading="loading" @click="load">刷新本趟状态</el-button></header>
    <el-alert v-if="error" type="error" :closable="false" :title="error" show-icon />
    <el-card v-loading="loading" class="summary">
      <template v-if="record">
        <div class="summary-top"><div><span class="muted">{{record.record_no}}</span><h1>{{record.plate_number}}</h1></div><el-tag size="large" :type="record.phase === 'completed' ? 'success' : 'info'">{{PHASES[record.phase] || record.phase}}</el-tag></div>
        <el-alert v-if="record.invite_revoked_at" title="本趟入口已停用，未确认司机无法再从此入口进入。档案保留供核对。" type="warning" :closable="false" />
        <div class="facts"><div><span>发货日期 / 方向</span><b>{{record.ship_date || '—'}} · {{record.description || '—'}}</b></div><div><span>基础资料提交</span><b>{{formatDateTime(record.departed_at)}}</b></div><div><span>运输完成</span><b>{{formatDateTime(record.completed_at)}}</b></div><div><span>有效照片 / 待处理</span><b>{{record.photo_count}} / {{record.pending_count}}</b></div></div>
        <el-alert v-if="record.legacy_warning" :title="record.legacy_warning" type="warning" :closable="false" />
      </template>
    </el-card>
    <div class="events-heading"><h2>按本趟实际记录查看</h2><el-switch v-model="corrections" active-text="显示取消和移除记录" /></div>
    <el-empty v-if="!loading && !groups.length" description="本趟还没有拍照或问题记录" />
    <el-card v-for="group in groups" :key="group.id" class="event">
      <div class="event-head"><div><h3>{{group.name}}</h3><span class="muted">{{formatDateTime(group.created_at)}} · {{group.active_count}} 张有效照片</span></div><el-tag :type="group.status === 'closed' ? 'success' : group.status === 'cancelled' ? 'warning' : 'info'">{{group.status === 'closed' ? '本次已保存' : group.status === 'cancelled' ? '空记录已取消' : group.kind === 'door' ? '本次进行中' : group.kind === 'base' ? '运输前必拍' : '问题 / 现场记录'}}</el-tag></div>
      <p v-if="group.note" class="note">{{group.note}}</p>
      <div v-if="group.photos.length" class="photo-grid">
        <article v-for="(photo,index) in group.photos" :key="photo.id" :class="['photo',{'removed':photo.removed_at}]">
          <button v-if="!photo.removed_at" class="thumb" @click="open(group,photo.id)">
            <img v-if="links[photo.id]?.watermarked_url || links[photo.id]?.original_url" :src="links[photo.id].watermarked_url || links[photo.id].original_url" @error="imageError(photo.id)" alt="现场照片，点击放大" />
            <span v-else>{{photo.has_original ? '点击查看照片' : '原图尚未归档'}}</span>
          </button>
          <div class="photo-info"><b>{{index + 1}}. {{TYPES[photo.type] || photo.type}}</b><div :class="{'warning':photo.status !== 'ready'}">{{photo.removed_at ? '已移除 · 保留纠正记录' : PHOTO_STATUS[photo.status] || photo.status}}</div><div>拍摄：{{formatDateTime(photo.capture_time)}}</div><div>接收：{{formatDateTime(photo.received_at)}}</div><div v-if="photo.removed_at" class="note">原因：{{photo.removal_reason || '未提供'}}</div><div v-else class="actions"><el-button type="primary" link :disabled="!photo.has_original" @click="open(group,photo.id)">查看 / 切换原图</el-button><el-button link :loading="linkBusy[photo.id]" @click="refreshLink(photo)">刷新链接</el-button></div><div v-if="linkErrors[photo.id]" class="warning">{{linkErrors[photo.id]}}</div></div>
        </article>
      </div>
      <p v-else class="muted">{{group.kind === 'issue' && group.note ? '此条为文字问题记录。' : '这条记录暂未收到照片。'}}</p>
    </el-card>
    <el-dialog v-model="galleryVisible" :title="galleryTitle" width="92%" top="4vh" append-to-body destroy-on-close>
      <template v-if="selected">
        <div class="viewer-tools"><el-button @click="previous" :disabled="selectedIndex <= 0">上一张</el-button><span>{{selectedIndex + 1}} / {{galleryPhotos.length}}</span><el-button @click="next" :disabled="selectedIndex >= galleryPhotos.length - 1">下一张</el-button><el-radio-group v-model="kind"><el-radio-button value="watermarked" :disabled="!selected.has_watermark">水印图</el-radio-button><el-radio-button value="original" :disabled="!selected.has_original">原图</el-radio-button></el-radio-group><el-button @click="refreshLink(selected)" :loading="linkBusy[selected.id]">链接过期？刷新</el-button></div>
        <el-alert v-if="selected.status === 'legacy_unverified'" title="旧图水印质量待核验；“水印图”仅表示旧记录中的派生文件。" type="warning" :closable="false" />
        <div class="viewer" v-loading="linkBusy[selected.id]"><img v-if="currentUrl" :src="currentUrl" @error="imageError(selected.id)" :alt="kind === 'original' ? '原图' : '水印图'" /><el-empty v-else :description="linkErrors[selected.id] || '正在获取访问链接…'" /></div>
        <p class="muted">拍摄 {{formatDateTime(selected.capture_time)}} · 服务器接收 {{formatDateTime(selected.received_at)}} · {{record?.source === 'v1' ? '定位未采集' : selected.location_text || '定位未获取'}}</p>
      </template>
    </el-dialog>
  </main>
</template>
<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getRecordAdmin, photoLinks } from '../api/admin';
import { clearToken, formatDateTime } from '../utils/auth';
import { PHASES, PHOTO_STATUS, TYPES, groupedEvents } from '../utils/workflow';
const route = useRoute(), router = useRouter(), source = route.query.source === 'legacy' ? 'legacy' : 'v1';
const record = ref(null), events = ref([]), photos = ref([]), loading = ref(false), error = ref(''), corrections = ref(false);
const links = reactive({}), linkBusy = reactive({}), linkErrors = reactive({});
const groups = computed(() => groupedEvents(events.value, photos.value, corrections.value));
const galleryVisible = ref(false), galleryEvent = ref(null), selectedId = ref(''), kind = ref('watermarked');
const galleryPhotos = computed(() => photos.value.filter(p => p.event_id === galleryEvent.value && !p.removed_at && p.has_original)
  .sort((a,b) => (a.created_at || 0) - (b.created_at || 0) || a.id.localeCompare(b.id)));
const selectedIndex = computed(() => galleryPhotos.value.findIndex(p => p.id === selectedId.value));
const selected = computed(() => galleryPhotos.value[selectedIndex.value]);
const galleryTitle = computed(() => events.value.find(e => e.id === galleryEvent.value)?.name || '本次照片');
const currentUrl = computed(() => selected.value && (kind.value === 'original' ? links[selected.value.id]?.original_url : links[selected.value.id]?.watermarked_url));
function check(response) {
  if (response?.code === 'FORBIDDEN') { clearToken(); router.replace('/login'); }
  if (!response?.success) throw new Error(response?.message || '读取未完成，请重试');
  return response.data;
}
async function load() {
  if (loading.value) return;
  loading.value = true; error.value = '';
  try {
    const data = check(await getRecordAdmin(route.params.recordId, source));
    record.value = data.record; events.value = data.events; photos.value = data.photos;
    for (const id of Object.keys(links)) delete links[id];
  } catch(e) { error.value = e.message || '读取失败，返回列表时仍保留筛选条件'; }
  finally { loading.value = false; }
}
async function refreshLink(photo) {
  if (!photo || linkBusy[photo.id] || photo.removed_at) return;
  linkBusy[photo.id] = true; linkErrors[photo.id] = '';
  try {
    const result = check(await photoLinks(route.params.recordId, source, photo.id));
    if (!result.original_url && !result.watermarked_url) throw new Error('暂未取得图片链接，请稍后刷新');
    links[photo.id] = result;
  } catch(e) { linkErrors[photo.id] = e.message || '获取链接失败，请重试'; }
  finally { linkBusy[photo.id] = false; }
}
function imageError(id) { linkErrors[id] = '图片未加载，访问链接可能过期，请刷新链接'; delete links[id]; }
async function choose(photo) {
  selectedId.value = photo.id; kind.value = photo.has_watermark ? 'watermarked' : 'original';
  await refreshLink(photo);
}
async function open(group, id) { galleryEvent.value = group.id; const photo = galleryPhotos.value.find(p => p.id === id); if (!photo) return; galleryVisible.value = true; await choose(photo); }
function previous() { const photo = galleryPhotos.value[selectedIndex.value - 1]; if (photo) choose(photo); }
function next() { const photo = galleryPhotos.value[selectedIndex.value + 1]; if (photo) choose(photo); }
function back() { const destination = String(route.query.back || '/'); router.push(destination.startsWith('/') && !destination.startsWith('//') ? destination : '/'); }
onMounted(load);
</script>
<style scoped>
.page{padding:28px;max-width:1400px;margin:auto}.heading,.summary-top,.event-head,.events-heading{display:flex;justify-content:space-between;align-items:center;gap:16px}.heading{margin-bottom:20px}.summary{margin:18px 0 28px}h1{font-size:34px;margin:8px 0 14px;color:#214c34}h2{font-size:20px}h3{font-size:18px;margin:0 0 10px}.muted{font-size:13px;color:#6e7e72;line-height:1.8}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:22px;margin:20px 0}.facts span,.facts b{display:block}.facts span{font-size:13px;color:#738478;margin-bottom:8px}.facts b{font-size:14px;font-weight:500}.event{margin:20px 0}.note{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px;margin-top:24px}.photo{border:1px solid #dce4dc;border-radius:10px;overflow:hidden}.thumb{display:flex;justify-content:center;align-items:center;width:100%;height:160px;background:#eef2ed;border:0;cursor:pointer;color:#476151}.thumb img{width:100%;height:100%;object-fit:cover}.photo-info{padding:14px;font-size:12px;line-height:1.9;color:#617367}.photo-info b{font-size:14px;color:#264832}.warning{color:#a26024}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}.removed{background:#f7f2ed}.viewer-tools{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:18px}.viewer{height:65vh;overflow:auto;background:#f1f3ef;display:flex;justify-content:center;align-items:flex-start}.viewer img{max-width:100%;height:auto;display:block}.el-alert{margin:14px 0}@media(max-width:650px){.page{padding:14px}.summary-top,.events-heading{align-items:flex-start;flex-direction:column}.viewer{height:55vh}.photo-grid{grid-template-columns:1fr}}
</style>
