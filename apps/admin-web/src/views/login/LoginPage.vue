<template>
  <div class="login-page">
    <el-button class="theme-toggle" circle @click="theme.toggle()">
      {{ theme.isDark ? '日' : '夜' }}
    </el-button>
    <el-card class="login-card">
      <h2>物业管理系统</h2>
      <p class="sub">管理端（项目端 / 公司管理端）</p>
      <el-form :model="form" @submit.prevent="handleLogin">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" size="large" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" native-type="submit">
          登 录
        </el-button>
      </el-form>
      <p class="tip">初始账号：admin / admin123</p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';

const router = useRouter();
const auth = useAuthStore();
const theme = useThemeStore();
const loading = ref(false);
const form = reactive({ username: 'admin', password: 'admin123' });

async function handleLogin() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    await auth.fetchUserInfo();
    ElMessage.success(`欢迎，${auth.userInfo?.realName ?? auth.userInfo?.username}`);
    router.push('/home');
  } catch {
    // 错误提示已由 axios 拦截器统一处理（PMS-6001 停用等）
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: var(--pms-bg);
}
.theme-toggle {
  position: absolute;
  top: 20px;
  right: 20px;
  font-weight: 600;
}
.login-card {
  width: 380px;
  text-align: center;
  background: var(--pms-surface);
}
.login-card h2 { color: var(--pms-text); margin: 0 0 4px; }
.sub { color: var(--pms-text-muted); margin-bottom: 20px; }
.tip { color: var(--pms-text-muted); font-size: 12px; margin-top: 12px; }
</style>
