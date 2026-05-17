<script setup lang="ts">
import { useThemeStore } from '../stores/theme';

const store = useThemeStore();
</script>

<template>
  <button class="theme-toggle" @click="store.toggle" :title="`Switch to ${store.theme === 'dark' ? 'light' : 'dark'} mode`">
    {{ store.theme === 'dark' ? '☀️' : '🌙' }}
  </button>
</template>

<style scoped>
.theme-toggle {
  background: none;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: background 0.15s;
}

.theme-toggle:hover {
  background: var(--hover-bg, #f0f0f0);
}
</style>
