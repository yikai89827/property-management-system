import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/verify' },
    { path: '/verify', component: () => import('@/views/verify/VerifyPage.vue') },
    { path: '/arrears', component: () => import('@/views/arrears/ArrearsPage.vue') },
    { path: '/charge', component: () => import('@/views/charge/ChargePage.vue') },
    { path: '/charge/result', component: () => import('@/views/charge/ChargeResultPage.vue') },
    { path: '/receipts', component: () => import('@/views/receipts/ReceiptListPage.vue') },
    { path: '/receipts/:orderNo', component: () => import('@/views/receipts/ReceiptDetailPage.vue') },
  ],
});

/** 业主令牌守卫：未验证跳验证页 */
router.beforeEach((to) => {
  const token = localStorage.getItem('pms_owner_token');
  if (to.path !== '/verify' && !token) return '/verify';
  return true;
});

export default router;