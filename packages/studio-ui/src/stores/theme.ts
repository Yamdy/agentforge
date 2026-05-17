import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export const useThemeStore = defineStore('theme', () => {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('studio-theme') : null;
  const theme = ref<'dark' | 'light'>(stored === 'light' ? 'light' : 'dark');

  function apply() {
    document.documentElement.dataset.theme = theme.value;
  }

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  watch(theme, (val) => {
    localStorage.setItem('studio-theme', val);
    apply();
  });

  // Apply on init
  if (typeof document !== 'undefined') {
    apply();
  }

  return { theme, toggle };
});
