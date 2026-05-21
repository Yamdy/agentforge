<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';
import ThemeToggle from './ThemeToggle.vue';
import { usePermissions } from '../composables/usePermissions';

const router = useRouter();
const route = useRoute();
const { pendingCount } = usePermissions();

const navItems = [
  { name: 'Dashboard', path: '/' },
  { name: 'Traces', path: '/traces' },
  { name: 'Sessions', path: '/sessions' },
  { name: 'Permissions', path: '/permissions' },
];

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/';
  return route.path.startsWith(path);
}

function navigate(path: string) {
  router.push(path);
}
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>AgentForge Studio</h2>
      </div>
      <nav class="sidebar-nav">
        <button
          v-for="item in navItems"
          :key="item.path"
          :class="['nav-item', { active: isActive(item.path) }]"
          @click="navigate(item.path)"
        >
          {{ item.name }}
          <span v-if="item.name === 'Permissions' && pendingCount > 0" class="badge">{{ pendingCount }}</span>
        </button>
      </nav>
    </aside>
    <div class="main-area">
      <header class="top-bar">
        <h1 class="page-title">AgentForge Studio</h1>
        <ThemeToggle />
      </header>
      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 240px;
  background: var(--sidebar-bg, #1a1a2e);
  color: var(--sidebar-fg, #e0e0e0);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid var(--sidebar-border, #2a2a3e);
}

.sidebar-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
}

.nav-item {
  background: none;
  border: none;
  color: var(--sidebar-fg, #e0e0e0);
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  transition: background 0.15s;
}

.nav-item:hover {
  background: var(--sidebar-hover-bg, #2a2a3e);
}

.nav-item.active {
  background: var(--sidebar-active-bg, #3a3a5e);
  font-weight: 600;
}

.badge {
  background: #dc2626;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 10px;
  padding: 0 7px;
  line-height: 18px;
  margin-left: 8px;
  display: inline-block;
  min-width: 18px;
  text-align: center;
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--topbar-bg, #ffffff);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  background: var(--content-bg, #f5f5f5);
}
</style>
