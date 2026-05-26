<script setup lang="ts">
defineProps<{
  events: Array<{
    type: string;
    timestamp: string;
    payload?: unknown;
  }>;
  maxItems?: number;
}>();
</script>

<template>
  <div class="event-log">
    <div
      v-for="(evt, i) in events.slice(0, maxItems ?? 50)"
      :key="i"
      :class="['event-row', evt.type]"
    >
      <span class="event-time">{{ new Date(evt.timestamp).toLocaleTimeString() }}</span>
      <span class="event-type">{{ evt.type }}</span>
      <span v-if="evt.payload" class="event-payload">
        {{ typeof evt.payload === 'string' ? evt.payload : JSON.stringify(evt.payload) }}
      </span>
    </div>
    <div v-if="events.length === 0" class="no-events">No events</div>
  </div>
</template>

<style scoped>
.event-log {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-family: monospace;
  font-size: 11px;
}

.event-row {
  display: flex;
  gap: 6px;
  padding: 2px 6px;
  border-radius: 2px;
}

.event-row:hover {
  background: var(--hover-bg, #f0f0f0);
}

.event-time {
  color: var(--text-secondary, #888);
  flex-shrink: 0;
}

.event-type {
  color: var(--text-primary, #111);
  font-weight: 600;
  flex-shrink: 0;
}

.event-payload {
  color: var(--text-secondary, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-row.error .event-type { color: #ef4444; }
.event-row.warning .event-type { color: #f59e0b; }
.event-row.agent\:start .event-type { color: #3b82f6; }
.event-row.agent\:end .event-type { color: #10b981; }

.no-events {
  color: var(--text-secondary, #aaa);
  text-align: center;
  padding: 8px;
  font-size: 12px;
}
</style>
