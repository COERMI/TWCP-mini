<template>
  <main class="page">
    <header class="heading">
      <div><span class="eyebrow">总部 · 运输影像归档</span><h1>本趟运输，记录可查</h1></div>
      <div class="heading-actions"><DispatchTrip ref="dispatch" :local-review="localReview" @created="created" /><el-button @click="logout">退出登录</el-button></div>
    </header>
    <el-card class="filter-card">
      <el-form inline @submit.prevent="search">
        <el-form-item label="档案范围">
          <el-select v-model="query.source" style="width:160px" @change="changeSource">
            <el-option label="新版运输" value="v1" /><el-option label="旧档案" value="legacy" />
          </el-select>
        </el-form-item>
        <el-form-item label="车牌 / 编号"><el-input v-model="query.keyword" clearable placeholder="输入车牌或档案编号" style="width:220px" @keyup.enter="search" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.phase" clearable style="width:170px">
            <el-option v-for="phase in availablePhases" :key="phase" :label="PHASES[phase]" :value="phase" />
          </el-select>
        </el-form-item>
        <el-form-item label="创建日期（北京时间）">
          <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:270px" />
        </el-form-item>
        <el-form-item label="排序">
          <el-select v-model="query.sort" style="width:180px" @change="search">
            <el-option label="创建时间最新优先" value="created_desc" />
            <el-option v-if="query.source === 'v1'" label="最近更新优先" value="updated_desc" />
          </el-select>
        </el-form-item>
        <el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></el-form-item>
      </el-form>
    </el-card>
    <el-alert v-if="query.source === 'legacy'" type="warning" :closable="false" title="旧档案保留原分组。已提交基础资料不代表运输完成，旧水印质量仍需核验。" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" show-icon />
    <el-card class="results">
      <div class="results-head"><h2>{{ query.source === 'v1' ? '运输记录' : '旧档案记录' }}</h2><span>{{ total }} 趟 · 同车不同趟独立保存</span></div>
      <el-table :data="list" v-loading="loading" stripe row-key="id" :empty-text="error ? '查询未完成，请重试' : '没有符合条件的记录，试试清空筛选'">
        <el-table-column prop="record_no" label="档案编号" min-width="170" />
        <el-table-column prop="plate_number" label="车牌" min-width="115" />
        <el-table-column label="状态" min-width="150"><template #default="{row}"><el-tag :type="row.invite_revoked_at ? 'warning' : row.phase === 'completed' ? 'success' : 'info'">{{ row.invite_revoked_at ? '入口已停用' : PHASES[row.phase] || row.phase }}</el-tag></template></el-table-column>
        <el-table-column label="发货日期 / 方向" min-width="210"><template #default="{row}"><div>{{ row.ship_date || '—' }}</div><span class="muted">{{ row.description || '—' }}</span></template></el-table-column>
        <el-table-column label="最近更新（北京时间）" min-width="180"><template #default="{row}">{{ formatDateTime(row.updated_at || row.created_at) }}</template></el-table-column>
        <el-table-column label="开关门" min-width="90"><template #default="{row}">{{ row.source === 'v1' ? row.closed_door_count + ' 组' : '按旧分组' }}</template></el-table-column>
        <el-table-column prop="photo_count" label="有效照片" min-width="90" />
        <el-table-column label="操作" width="150" fixed="right"><template #default="{row}"><el-button type="primary" link @click="detail(row)">查看本趟</el-button><el-button v-if="row.source === 'v1' && row.phase === 'awaiting_plate' && !row.invite_revoked_at" type="primary" link @click="invitation(row)">本趟入口</el-button></template></el-table-column>
      </el-table>
      <div class="pagination"><el-pagination :total="total" v-model:current-page="query.page" v-model:page-size="query.pageSize" :page-sizes="[10,20,50,100]" layout="total, prev, pager, next, sizes" @current-change="load" @size-change="search" /></div>
    </el-card>
  </main>
</template>
<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { listRecords } from '../api/admin';
import { clearToken, formatDateTime } from '../utils/auth';
import { PHASES } from '../utils/workflow';
import DispatchTrip from '../components/DispatchTrip.vue';
const dispatch = ref(null), localReview = window.__APP_CONFIG__?.transport === 'local-review';
const route = useRoute(), router = useRouter();
const positive = (v, fallback, max) => Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= max ? Number(v) : fallback;
const query = reactive({ source: route.query.source === 'legacy' ? 'legacy' : 'v1', keyword: String(route.query.keyword || ''),
  phase: String(route.query.phase || ''),
  sort: route.query.source !== 'legacy' && route.query.sort === 'updated_desc' ? 'updated_desc' : 'created_desc',
  page: positive(route.query.page, 1, 1000), pageSize: positive(route.query.pageSize, 20, 100) });
const dateRange = ref(route.query.date_from && route.query.date_to ? [route.query.date_from, route.query.date_to] : null);
const availablePhases = computed(() => query.source === 'legacy' ? ['legacy_active','legacy_submitted'] : ['awaiting_plate','preparing','transporting','completed']);
const list = ref([]), total = ref(0), loading = ref(false), error = ref('');
let generation = 0;
async function load() {
  const current = ++generation; loading.value = true; error.value = ''; list.value = []; total.value = 0;
  const params = { ...query };
  if (dateRange.value?.length === 2) [params.date_from, params.date_to] = dateRange.value;
  await router.replace({ path: '/', query: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '')) });
  try {
    const response = await listRecords(params);
    if (current !== generation) return;
    if (!response?.success) {
      if (response?.code === 'FORBIDDEN') { logout(); return; }
      throw new Error(response?.message || '查询失败，请重试');
    }
    list.value = response.data.list; total.value = response.data.total;
  } catch (e) { if (current === generation) error.value = e.message || '连接未完成，筛选条件已保留，请重试'; }
  finally { if (current === generation) loading.value = false; }
}
function search() { query.page = 1; load(); }
function changeSource() { query.phase = ''; query.sort = 'created_desc'; search(); }
function reset() { query.keyword = ''; query.phase = ''; dateRange.value = null; search(); }
function detail(row) { router.push({ path: '/record/' + encodeURIComponent(row.id), query: { source: row.source, back: route.fullPath } }); }
function created(record) {
  if (record) { query.source = 'v1'; query.keyword = record.record_no; query.phase = ''; query.page = 1; dateRange.value = null; }
  load();
}
async function invitation(row) {
  try { await dispatch.value.openInvitation(row); } catch(e) { error.value = e.message || '暂未取得本趟入口，请重试'; }
}
function logout() { clearToken(); router.replace('/login'); }
onMounted(load);
</script>
<style scoped>
.page{padding:32px;max-width:1600px;margin:auto}.heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px;gap:16px;flex-wrap:wrap}.heading-actions{display:flex;gap:12px}.eyebrow{color:#65776c;font-size:14px}h1{font-size:27px;margin:10px 0;color:#213e30}h2{font-size:18px;margin:0}.filter-card{margin-bottom:20px}.results{margin-top:20px}.results-head{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:20px;color:#67786c}.muted{font-size:12px;color:#758378}.pagination{display:flex;justify-content:flex-end;margin-top:24px}.el-alert{margin-top:16px}@media(max-width:700px){.page{padding:16px}h1{font-size:21px}.results-head{display:block}.results-head span{display:block;margin-top:12px}.pagination{overflow:auto;justify-content:flex-start}}
</style>
