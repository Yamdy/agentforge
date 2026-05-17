<script setup lang="ts">
defineProps<{
  title: string;
  value: string | number;
  trend?: number;
  loading?: boolean;
}>();
</script>

<template>
  <div class="kpi-card" :class="{ loading }">
    <div class="kpi-title">{{ title }}</div>
    <div class="kpi-value">
      <span v-if="loading">...</span>
      <span v-else>{{ value }}</span>
    </div>
    <div v-if="trend !== undefined && !loading" class="kpi-trend" :class="{ up: trend >= 0, down: trend < 0 }">
      {{ trend >= 0 ? '+' : '' }}{{ trend }}%
    </div>
  </div>
</template>

<style scoped>
.kpi-card {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  min-width: 160px;
}

.kpi-card.loading {
  opacity: 0.6;
}

.kpi-title {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--muted-color, #888);
  margin-bottom: 8px;
}

.kpi-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-color, #222);
}

.kpi-trend {
  margin-top: 6px;
  font-size: 13px;
  font-weight: 600;
}

.kpi-trend.up {
  color: #22c55e;
}

.kpi-trend.down {
  color: #ef4444;
}
</style>
