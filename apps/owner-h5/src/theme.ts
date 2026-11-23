import { computed, ref } from 'vue';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'pms_owner_theme';

function readStored(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'dark' ? 'dark' : 'light';
}

function applyDom(mode: ThemeMode) {
  document.documentElement.classList.toggle('van-theme-dark', mode === 'dark');
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
}

const mode = ref<ThemeMode>(readStored());
applyDom(mode.value);

export function useTheme() {
  const isDark = computed(() => mode.value === 'dark');

  function setMode(next: ThemeMode) {
    mode.value = next;
    localStorage.setItem(STORAGE_KEY, next);
    applyDom(next);
  }

  function toggle() {
    setMode(mode.value === 'dark' ? 'light' : 'dark');
  }

  return { mode, isDark, setMode, toggle };
}
