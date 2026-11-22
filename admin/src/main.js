import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import App from './App.vue';
import router from './router';
import config from './config';
import { initApp } from './api/cloudbase';

// 初始化 CloudBase Web SDK（envId 来自部署目录的 config.js）
if (config.envId && config.envId !== 'your-cloud-env-id') {
  initApp(config);
}

const app = createApp(App);

// 全局注册 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

app.use(ElementPlus);
app.use(router);
app.mount('#app');
