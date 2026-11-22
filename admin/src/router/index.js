import { createRouter, createWebHashHistory } from 'vue-router';
import { isLoggedIn } from '../utils/auth';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: 'list',
    component: () => import('../views/RecordList.vue'),
  },
  {
    path: '/record/:recordId',
    name: 'detail',
    component: () => import('../views/RecordDetail.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

// 用 hash 模式：部署到静态托管无需配置路由重写，刷新详情页也不会 404
const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// 登录守卫：未登录跳转到登录页
router.beforeEach((to, from, next) => {
  if (to.meta.public) {
    next();
  } else if (!isLoggedIn()) {
    next({ path: '/login', query: { redirect: to.fullPath } });
  } else {
    next();
  }
});

export default router;
