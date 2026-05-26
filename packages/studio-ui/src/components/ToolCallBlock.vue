<script setup lang="ts">
defineProps<{
  toolCalls: Array<{
    name: string;
    args?: Record<string, unknown>;
    result?: unknown;
    status: 'pending' | 'running' | 'completed' | 'failed';
  }>;
}>();
</script>

<template>
  <div class="tool-calls">
    <div v-for="(tc, i) in toolCalls" :key="i" :class="['tool-call', tc.status]">
      <div class="tool-header">
        <span :class="['tool-status-dot', tc.status]"></span>
        <span class="tool-name">{{ tc.name }}</span>
      </div>
      <div v-if="tc.args && Object.keys(tc.args).length" class="tool-args">
        <pre>{{ JSON.stringify(tc.args, null, 1) }}</pre>
      </div>
      <div v-if="tc.result !== undefined" class="tool-result">
        <span class="result-label">Result:</span>
        <pre>{{ typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 1) }}</pre>
      </div>
    </div>
    <div v-if="toolCalls.length === 0" class="no-calls">No tool calls</div>
  </div>
</template>

<style scoped>
.tool-calls {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-call {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  overflow: hidden;
  font-size: 12px;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--panel-bg, #fafafa);
}

.tool-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tool-status-dot.pending { background: #d1d5db; }
.tool-status-dot.running { background: #3b82f6; animation: pulse 1.5s infinite; }
.tool-status-dot.completed { background: #10b981; }
.tool-status-dot.failed { background: #ef4444; }

.tool-name {
  font-weight: 600;
  font-family: monospace;
  color: var(--text-primary, #111);
}

.tool-args,
.tool-result {
  padding: 4px 8px;
  border-top: 1px solid var(--border-color, #eee);
}

.tool-args pre,
.tool-result pre {
  margin: 0;
  font-size: 11px;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary, #555);
}

.result-label {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--text-secondary, #888);
}

.no-calls {
  color: var(--text-secondary, #aaa);
  font-size: 12px;
  text-align: center;
  padding: 8px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
