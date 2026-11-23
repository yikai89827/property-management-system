import { defineStore } from 'pinia';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'pms_theme';

function readStored(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'dark' ? 'dark' : 'light';
}

function applyDom(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
}

/** 应用主题（日间 / 夜间），持久化到 localStorage */
export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: readStored() as ThemeMode,
  }),
  getters: {
    isDark: (s) => s.mode === 'dark',
  },
  actions: {
    init() {
      applyDom(this.mode);
    },
    setMode(mode: ThemeMode) {
      this.mode = mode;
      localStorage.setItem(STORAGE_KEY, mode);
      applyDom(mode);
    },
    toggle() {
      this.setMode(this.mode === 'dark' ? 'light' : 'dark');
    },
  },
});
