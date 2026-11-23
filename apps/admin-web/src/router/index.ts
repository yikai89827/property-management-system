import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { PermissionCodes } from '@pms/shared';

/** 静态路由（无需权限） */
const staticRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: () => import('@/views/login/LoginPage.vue'),
  },
];

/** 权限路由注册表：路由 → 所需权限点 */
const permissionRoutes: { path: string; component: () => Promise<unknown>; permission: string; title: string }[] = [
  { path: '/home', component: () => import('@/views/home/HomePage.vue'), permission: '', title: '首页' },
  { path: '/projects', component: () => import('@/views/project/ProjectListPage.vue'), permission: PermissionCodes.PROJECT_VIEW, title: '项目管理' },
  { path: '/customers', component: () => import('@/views/customer/CustomerListPage.vue'), permission: PermissionCodes.CUSTOMER_VIEW, title: '客户档案' },
  { path: '/customers/:id', component: () => import('@/views/customer/CustomerDetailPage.vue'), permission: PermissionCodes.CUSTOMER_VIEW, title: '客户详情' },
  { path: '/charging/delivery', component: () => import('@/views/charging/DeliveryChargePage.vue'), permission: PermissionCodes.CHARGE_DELIVERY_EXECUTE, title: '交房缴费' },
  { path: '/charging/property', component: () => import('@/views/charging/PropertyChargePage.vue'), permission: PermissionCodes.CHARGE_PROPERTY_EXECUTE, title: '物业费续费' },
  { path: '/charging/other', component: () => import('@/views/charging/OtherChargePage.vue'), permission: PermissionCodes.CHARGE_OTHER_EXECUTE, title: '其他缴费' },
  { path: '/charging/receipts', component: () => import('@/views/charging/ReceiptListPage.vue'), permission: PermissionCodes.CHARGE_RECEIPT_VIEW, title: '收款单查询' },
  { path: '/payment-confirm', component: () => import('@/views/payment/PaymentConfirmPage.vue'), permission: PermissionCodes.PAYMENT_RECORD_CONFIRM, title: '收款确认' },
  { path: '/statistics', component: () => import('@/views/statistics/StatisticsPage.vue'), permission: PermissionCodes.STATISTIC_MONTHLY_VIEW, title: '统计报表' },
  { path: '/permission', component: () => import('@/views/permission/PermissionManagePage.vue'), permission: PermissionCodes.USER_MANAGE, title: '权限管理' },
  { path: '/settings', component: () => import('@/views/settings/SettingsPage.vue'), permission: PermissionCodes.FEE_PARAMETER_MANAGE, title: '系统配置' },
];

/** 二期灰置菜单（不可点击） */
export const phase2Menus = [
  { title: '工单管理（二期）' },
  { title: '人力资源（二期）' },
  { title: '增值服务（二期）' },
];

export function buildMenus(permissions: string[]) {
  const menus = permissionRoutes
    // 带动态参数的详情页不进侧栏（否则会导航到字面量 `/customers/:id` → NaN）
    .filter((r) => !r.path.includes(':'))
    .filter((r) => !r.permission || permissions.includes(r.permission))
    .map((r) => ({ path: r.path, title: r.title, phase2: false }));
  return [...menus, ...phase2Menus.map((m) => ({ ...m, path: '', phase2: true }))];
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    ...staticRoutes,
    {
      path: '/',
      component: () => import('@/views/layout/MainLayout.vue'),
      redirect: '/home',
      children: permissionRoutes.map((r) => ({
        path: r.path.slice(1),
        component: r.component as never,
        meta: { title: r.title, permission: r.permission },
      })),
    },
  ],
});

/** 路由守卫：登录态 + 权限校验（未授权 URL 拦截） */
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.path === '/login') return true;
  if (!auth.isLoggedIn) return '/login';
  if (!auth.userInfo) {
    try {
      await auth.fetchUserInfo();
    } catch {
      auth.logout();
      return '/login';
    }
  }
  const permission = (to.meta?.permission as string) ?? '';
  if (permission && !auth.hasPermission(permission)) {
    return '/home';
  }
  return true;
});

export { router };
export default router;