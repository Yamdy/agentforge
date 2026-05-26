<script setup lang="ts">
defineProps<{
  stages: Array<{ name: string; status: 'pending' | 'running' | 'completed' | 'failed'; duration?: number }>;
}>();
</script>

<template>
  <div class="pipeline-stages">
    <div
      v-for="(stage, i) in stages"
      :key="i"
      :class="['stage', stage.status]"
    >
      <div class="stage-connector" v-if="i > 0"></div>
      <div class="stage-node">
        <span class="stage-name">{{ stage.name }}</span>
        <span v-if="stage.duration" class="stage-duration">{{ stage.duration }}ms</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pipeline-stages {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stage {
  position: relative;
  padding-left: 12px;
}

.stage-connector {
  position: absolute;
  left: 4px;
  top: -2px;
  width: 2px;
  height: 6px;
  background: var(--border-color, #e0e0e0);
}

.stage-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.stage-node::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stage.pending .stage-node::before { background: #d1d5db; }
.stage.running .stage-node::before { background: #3b82f6; animation: pulse 1.5s infinite; }
.stage.completed .stage-node::before { background: #10b981; }
.stage.failed .stage-node::before { background: #ef4444; }

.stage-name {
  color: var(--text-primary, #111);
  font-family: monospace;
}

.stage-duration {
  color: var(--text-secondary, #888);
  font-size: 11px;
  margin-left: auto;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
