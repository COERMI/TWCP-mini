<template>
  <div class="login-wrap">
    <el-card class="login-card" shadow="always">
      <h2 class="title">运输影像归档系统</h2>
      <p class="subtitle">总部管理后台</p>
      <el-form @submit.prevent="onSubmit">
        <el-form-item>
          <el-input v-model="username" placeholder="管理员账号" size="large" clearable>
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="password"
            type="password"
            placeholder="密码"
            size="large"
            show-password
            @keyup.enter="onSubmit"
          >
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="onSubmit">
            登 录
          </el-button>
        </el-form-item>
      </el-form>
      <p class="hint">使用负责人提供的总部管理员账号登录</p>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { login } from '../api/admin';
import { setToken } from '../utils/auth';
import config from '../config';

const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const loading = ref(false);

async function onSubmit() {
  if (!config.envId || config.envId === 'your-cloud-env-id') {
    ElMessage.error('尚未配置云环境 ID，请先修改部署目录下 config.js 中的 envId');
    return;
  }
  if (!username.value || !password.value) {
    ElMessage.warning('请输入账号和密码');
    return;
  }
  loading.value = true;
  try {
    const res = await login(username.value, password.value);
    if (res && res.success) {
      setToken(res.data.token);
      ElMessage.success('登录成功');
      const redirect = route.query.redirect || '/';
      router.replace(redirect);
    } else {
      ElMessage.error((res && res.message) || '登录失败');
    }
  } catch (e) {
    ElMessage.error('登录请求失败，请检查网络或云环境配置');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f0f2f5 0%, #e6eefb 100%);
}
.login-card {
  width: 380px;
  padding: 8px 12px;
}
.title {
  text-align: center;
  margin: 8px 0 4px;
  color: #303133;
}
.subtitle {
  text-align: center;
  color: #909399;
  margin: 0 0 24px;
}
.hint {
  text-align: center;
  color: #c0c4cc;
  font-size: 12px;
  margin: 0;
}
</style>
