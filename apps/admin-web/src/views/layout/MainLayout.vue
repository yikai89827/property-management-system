<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo">{{ auth.userInfo?.companyName ?? '物业管理系统' }}</div>
      <el-menu
        router
        :default-active="$route.path"
        class="menu"
        :background-color="theme.isDark ? '#1a1f2e' : undefined"
        :text-color="theme.isDark ? '#c9d1d9' : undefined"
        :active-text-color="theme.isDark ? '#409eff' : undefined"
      >
        <template v-for="m in menus" :key="m.title">
          <el-menu-item v-if="!m.phase2" :index="m.path">
            <span>{{ m.title }}</span>
          </el-menu-item>
          <el-tooltip v-else :content="`${m.title}：属于二期开发范围`" placement="right">
            <li class="el-menu-item is-disabled phase2">
              <span>{{ m.title }}</span>
            </li>
          </el-tooltip>
        </template>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
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
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { useThemeStore } from '@/stores/theme';
import { buildMenus } from '@/router';

const auth = useAuthStore();
const projectStore = useProjectStore();
const theme = useThemeStore();
const router = useRouter();
const menus = computed(() => buildMenus(auth.userInfo?.permissions ?? []));

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
  border-right: 1px solid var(--pms-border);
  background: var(--pms-aside-bg);
}
.logo {
  height: 56px;
  line-height: 56px;
  text-align: center;
  font-weight: 700;
  font-size: 14px;
  padding: 0 8px;
  overflow: hidden;
  color: var(--pms-logo);
  border-bottom: 1px solid var(--pms-border);
}
.header {
  border-bottom: 1px solid var(--pms-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--pms-surface);
}
.header-left { display: flex; align-items: center; gap: 16px; }
.project-switcher { width: 280px; }
.user-area { display: flex; align-items: center; gap: 12px; }
.user-name { color: var(--pms-text-secondary); }
.theme-btn { font-weight: 600; }
.main { background: var(--pms-main-bg); }
.phase2 { cursor: not-allowed; color: var(--pms-text-muted); }
.menu { border-right: none; }
</style>
