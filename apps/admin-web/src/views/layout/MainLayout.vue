<template>
  <el-container class="layout">
    <el-aside :width="asideWidth" class="aside" :class="{ collapsed: collapsed }">
      <div class="logo" :title="companyName">
        <span v-if="collapsed" class="logo-mark">卓</span>
        <span v-else class="logo-text">{{ companyName }}</span>
      </div>
      <el-menu
        router
        :default-active="$route.path"
        :collapse="collapsed"
        :collapse-transition="false"
        class="menu"
        :background-color="theme.isDark ? '#1a1f2e' : undefined"
        :text-color="theme.isDark ? '#c9d1d9' : undefined"
        :active-text-color="theme.isDark ? '#409eff' : undefined"
      >
        <template v-for="m in menus" :key="m.title + m.path">
          <el-menu-item v-if="!m.phase2" :index="m.path">
            <el-icon>
              <component :is="iconMap[m.icon]" />
            </el-icon>
            <template #title>{{ m.title }}</template>
          </el-menu-item>
          <el-tooltip
            v-else
            :content="`${m.title}：属于二期开发范围`"
            placement="right"
          >
            <li class="el-menu-item is-disabled phase2">
              <el-icon>
                <component :is="iconMap[m.icon]" />
              </el-icon>
              <span v-show="!collapsed" class="phase2-title">{{ m.title }}</span>
            </li>
          </el-tooltip>
        </template>
      </el-menu>
      <div class="aside-footer">
        <el-tooltip :content="collapsed ? '展开菜单' : '折叠菜单'" placement="right">
          <el-button class="collapse-btn" text @click="toggleCollapse">
            <el-icon :size="18">
              <Expand v-if="collapsed" />
              <Fold v-else />
            </el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-button class="collapse-header-btn" text @click="toggleCollapse">
            <el-icon :size="18">
              <Expand v-if="collapsed" />
              <Fold v-else />
            </el-icon>
          </el-button>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item>管理端</el-breadcrumb-item>
            <el-breadcrumb-item>{{ ($route.meta.title as string) ?? '首页' }}</el-breadcrumb-item>
          </el-breadcrumb>
          <el-select
            v-if="projectStore.options.length"
            :model-value="projectStore.currentProjectId"
            placeholder="切换物业项目（全站统一）"
            filterable
            class="project-switcher"
            @change="onProjectChange"
          >
            <el-option
              v-for="p in projectStore.options"
              :key="p.id"
              :label="p.address ? `${p.name}（${p.address}）` : p.name"
              :value="p.id"
            />
          </el-select>
        </div>
        <div class="user-area">
          <el-tooltip :content="theme.isDark ? '切换日间主题' : '切换夜间主题'" placement="bottom">
            <el-button class="theme-btn" circle @click="theme.toggle()">
              {{ theme.isDark ? '日' : '夜' }}
            </el-button>
          </el-tooltip>
          <span class="user-name">{{ auth.userInfo?.realName }}</span>
          <el-button link type="danger" @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Avatar,
  CircleCheck,
  Coin,
  DataAnalysis,
  Expand,
  Fold,
  HomeFilled,
  Key,
  List,
  Lock,
  OfficeBuilding,
  Present,
  Setting,
  Tickets,
  User,
  Wallet,
} from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { useThemeStore } from '@/stores/theme';
import { buildMenus, type MenuIconName } from '@/router';

const COLLAPSE_KEY = 'pms_aside_collapsed';

const auth = useAuthStore();
const projectStore = useProjectStore();
const theme = useThemeStore();
const router = useRouter();
const menus = computed(() => buildMenus(auth.userInfo?.permissions ?? []));
const companyName = computed(() => auth.userInfo?.companyName ?? '物业管理系统');

const iconMap: Record<MenuIconName, unknown> = {
  HomeFilled,
  OfficeBuilding,
  User,
  Key,
  Wallet,
  Coin,
  Tickets,
  CircleCheck,
  DataAnalysis,
  Lock,
  Setting,
  List,
  Avatar,
  Present,
};

const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1');
const asideWidth = computed(() => (collapsed.value ? '64px' : '220px'));

watch(collapsed, (v) => {
  localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
});

function toggleCollapse() {
  collapsed.value = !collapsed.value;
}

function onProjectChange(id: number | null) {
  projectStore.setCurrent(id);
}

function handleLogout() {
  auth.logout();
  router.push('/login');
}

onMounted(() => {
  // 全站业务页依赖顶部当前项目，登录后一律加载可选项目
  void projectStore.loadOptions();
});
</script>

<style scoped>
.layout { height: 100vh; background: var(--pms-bg); }
.aside {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--pms-border);
  background: var(--pms-aside-bg);
  transition: width 0.2s ease;
  overflow: hidden;
}
.logo {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  padding: 0 8px;
  overflow: hidden;
  color: var(--pms-logo);
  border-bottom: 1px solid var(--pms-border);
  flex-shrink: 0;
}
.logo-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
  line-height: 1.3;
}
.logo-mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 16px;
}
.menu {
  border-right: none;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  width: 100% !important;
}
.aside.collapsed .menu {
  width: 64px !important;
}
.aside-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--pms-border);
  padding: 8px;
  display: flex;
  justify-content: center;
}
.collapse-btn {
  width: 100%;
  height: 36px;
  color: var(--pms-text-secondary);
}
.header {
  border-bottom: 1px solid var(--pms-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--pms-surface);
}
.header-left { display: flex; align-items: center; gap: 12px; }
.collapse-header-btn {
  color: var(--pms-text-secondary);
  padding: 4px;
}
.project-switcher { width: 280px; }
.user-area { display: flex; align-items: center; gap: 12px; }
.user-name { color: var(--pms-text-secondary); }
.theme-btn { font-weight: 600; }
.main { background: var(--pms-main-bg); }
.phase2 {
  cursor: not-allowed;
  color: var(--pms-text-muted);
  display: flex;
  align-items: center;
  gap: 8px;
  height: 56px;
  padding: 0 20px;
  list-style: none;
}
.aside.collapsed .phase2 {
  justify-content: center;
  padding: 0;
}
.phase2-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
