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

/** 菜单图标名（与 @element-plus/icons-vue 导出一致） */
export type MenuIconName =
  | 'HomeFilled'
  | 'OfficeBuilding'
  | 'User'
  | 'Key'
  | 'Wallet'
  | 'Coin'
  | 'Tickets'
  | 'CircleCheck'
  | 'DataAnalysis'
  | 'Lock'
  | 'Setting'
  | 'List'
  | 'Avatar'
  | 'Present';

/** 权限路由注册表：路由 → 所需权限点 */
const permissionRoutes: {
  path: string;
  component: () => Promise<unknown>;
  permission: string;
  title: string;
  icon?: MenuIconName;
}[] = [
  { path: '/home', component: () => import('@/views/home/HomePage.vue'), permission: '', title: '首页', icon: 'HomeFilled' },
  { path: '/projects', component: () => import('@/views/project/ProjectListPage.vue'), permission: PermissionCodes.PROJECT_VIEW, title: '项目管理', icon: 'OfficeBuilding' },
  { path: '/customers', component: () => import('@/views/customer/CustomerListPage.vue'), permission: PermissionCodes.CUSTOMER_VIEW, title: '客户档案', icon: 'User' },
  { path: '/customers/:id', component: () => import('@/views/customer/CustomerDetailPage.vue'), permission: PermissionCodes.CUSTOMER_VIEW, title: '客户详情', icon: 'User' },
  { path: '/charging/delivery', component: () => import('@/views/charging/DeliveryChargePage.vue'), permission: PermissionCodes.CHARGE_DELIVERY_EXECUTE, title: '交房缴费', icon: 'Key' },
  { path: '/charging/property', component: () => import('@/views/charging/PropertyChargePage.vue'), permission: PermissionCodes.CHARGE_PROPERTY_EXECUTE, title: '物业费续费', icon: 'Wallet' },
  { path: '/charging/other', component: () => import('@/views/charging/OtherChargePage.vue'), permission: PermissionCodes.CHARGE_OTHER_EXECUTE, title: '其他缴费', icon: 'Coin' },
  { path: '/charging/receipts', component: () => import('@/views/charging/ReceiptListPage.vue'), permission: PermissionCodes.CHARGE_RECEIPT_VIEW, title: '收款单查询', icon: 'Tickets' },
  { path: '/payment-confirm', component: () => import('@/views/payment/PaymentConfirmPage.vue'), permission: PermissionCodes.PAYMENT_RECORD_CONFIRM, title: '收款确认', icon: 'CircleCheck' },
  { path: '/statistics', component: () => import('@/views/statistics/StatisticsPage.vue'), permission: PermissionCodes.STATISTIC_MONTHLY_VIEW, title: '统计报表', icon: 'DataAnalysis' },
  { path: '/permission', component: () => import('@/views/permission/PermissionManagePage.vue'), permission: PermissionCodes.USER_MANAGE, title: '权限管理', icon: 'Lock' },
  { path: '/settings', component: () => import('@/views/settings/SettingsPage.vue'), permission: PermissionCodes.FEE_PARAMETER_MANAGE, title: '系统配置', icon: 'Setting' },
];

/** 二期灰置菜单（不可点击） */
export const phase2Menus: { title: string; icon: MenuIconName }[] = [
  { title: '工单管理（二期）', icon: 'List' },
  { title: '人力资源（二期）', icon: 'Avatar' },
  { title: '增值服务（二期）', icon: 'Present' },
];

export function buildMenus(permissions: string[]) {
  const menus = permissionRoutes
    // 带动态参数的详情页不进侧栏（否则会导航到字面量 `/customers/:id` → NaN）
    .filter((r) => !r.path.includes(':'))
    .filter((r) => !r.permission || permissions.includes(r.permission))
    .map((r) => ({ path: r.path, title: r.title, icon: r.icon ?? 'HomeFilled', phase2: false as const }));
  return [
    ...menus,
    ...phase2Menus.map((m) => ({ path: '', title: m.title, icon: m.icon, phase2: true as const })),
  ];
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