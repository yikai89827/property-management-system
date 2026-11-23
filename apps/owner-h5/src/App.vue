<template>
  <van-config-provider :theme="mode">
    <div class="app-shell">
      <button class="theme-fab" type="button" @click="toggle">
        {{ isDark ? '日间' : '夜间' }}
      </button>
      <router-view />
    </div>
  </van-config-provider>
</template>

<script setup lang="ts">
import { useTheme } from './theme';

const { mode, isDark, toggle } = useTheme();
</script>

<style>
html,
body,
#app {
  margin: 0;
  min-height: 100%;
  background: var(--van-background, #f7f8fa);
}

.app-shell {
  min-height: 100vh;
  position: relative;
}

.theme-fab {
  position: fixed;
  top: 10px;
  right: 12px;
  z-index: 3000;
  border: 1px solid var(--van-border-color, #ebedf0);
  background: var(--van-background-2, #fff);
  color: var(--van-text-color, #323233);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
</style>
