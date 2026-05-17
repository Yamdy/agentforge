<script setup lang="ts">
import type { SpanNode } from '../types';

const props = defineProps<{
  rootSpan: SpanNode;
  traceDuration: number;
}>();

const emit = defineEmits<{
  select: [span: SpanNode];
}>();

const selectedSpanId = defineModel<string | null>('selectedSpanId', { default: null });

function getColor(name: string): string {
  if (name.toLowerCase().includes('llm') || name.toLowerCase().includes('invoke')) return '#f59e0b';
  if (name.toLowerCase().includes('tool') || name.toLowerCase().includes('execute')) return '#10b981';
  if (name.toLowerCase().includes('process') || name.toLowerCase().includes('prepare') || name.toLowerCase().includes('build') || name.toLowerCase().includes('evaluate')) return '#8b5cf6';
  return '#6366f1';
}

function select(span: SpanNode): void {
  selectedSpanId.value = span.span.spanId;
  emit('select', span);
}

const duration = props.traceDuration > 0 ? props.traceDuration : (props.rootSpan.span.durationMs || 1);

interface Row {
  span: SpanNode['span'];
  depth: number;
  node: SpanNode;
}

function flatten(node: SpanNode, depth: number, rows: Row[]): void {
  rows.push({ span: node.span, depth, node });
  for (const child of node.children) {
    flatten(child, depth + 1, rows);
  }
}

const rows: Row[] = [];
flatten(props.rootSpan, 0, rows);
</script>

<template>
  <div class="timeline-container">
    <div class="timeline-header">
      <div class="name-col">Span</div>
      <div class="bar-col">
        <div class="time-scale">
          <span v-for="tick in 6" :key="tick" class="tick" :style="{ left: `${(tick - 1) * 20}%` }">
            {{ Math.round((duration * (tick - 1) * 0.2)) }}ms
          </span>
        </div>
      </div>
      <div class="dur-col">Duration</div>
    </div>

    <div class="timeline-body">
      <div
        v-for="row in rows"
        :key="row.span.spanId"
        class="timeline-row"
        :class="{ selected: selectedSpanId === row.span.spanId }"
        @click="select(row.node)"
      >
        <div class="name-col" :style="{ paddingLeft: `${row.depth * 20 + 8}px` }">
          <span class="depth-indicator" v-if="row.depth > 0"></span>
          <span class="span-name">{{ row.span.name }}</span>
        </div>
        <div class="bar-col">
          <div class="bar-track">
            <div
              class="bar"
              :style="{
                left: duration > 0 ? `${(row.span.startTime / duration) * 100}%` : '0%',
                width: duration > 0 ? `${Math.max((row.span.durationMs / duration) * 100, 0.5)}%` : '0%',
                backgroundColor: getColor(row.span.name),
              }"
              :title="`${row.span.name}: ${row.span.durationMs}ms`"
            >
              <span class="bar-label" v-if="row.span.durationMs > duration * 0.1">
                {{ row.span.durationMs }}ms
              </span>
            </div>
          </div>
        </div>
        <div class="dur-col">{{ row.span.durationMs }}ms</div>
      </div>
      <div v-if="rows.length === 0" class="empty-state">No spans recorded.</div>
    </div>
  </div>
</template>

<style scoped>
.timeline-container {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--card-bg, #ffffff);
}

.timeline-header {
  display: flex;
  align-items: flex-end;
  padding: 8px 12px 4px;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--muted-color, #888);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--table-header-bg, #fafafa);
}

.timeline-body {
  max-height: 500px;
  overflow-y: auto;
}

.timeline-row {
  display: flex;
  align-items: center;
  padding: 3px 12px;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  transition: background 0.12s;
}

.timeline-row:hover { background: var(--hover-bg, #f5f5f5); }

.timeline-row.selected {
  background: rgba(99, 102, 241, 0.08);
  border-bottom-color: rgba(99, 102, 241, 0.2);
}

.name-col {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.span-name {
  font-size: 12px;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.depth-indicator {
  display: inline-block;
  width: 8px;
  height: 1px;
  background: var(--muted-color, #ccc);
  margin-right: 4px;
}

.bar-col { flex: 1; padding: 0 12px; }

.bar-track {
  position: relative;
  height: 22px;
  width: 100%;
  background: var(--bar-track-bg, #f0f0f0);
  border-radius: 3px;
  overflow: visible;
}

.bar {
  position: absolute;
  top: 2px;
  height: 18px;
  border-radius: 3px;
  opacity: 0.75;
  min-width: 4px;
  display: flex;
  align-items: center;
}

.bar-label {
  position: absolute;
  right: 4px;
  font-size: 9px;
  color: #fff;
  font-weight: 500;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.dur-col {
  width: 70px;
  flex-shrink: 0;
  text-align: right;
  font-size: 11px;
  font-family: monospace;
  color: var(--muted-color, #888);
}

.time-scale {
  position: relative;
  height: 16px;
  width: 100%;
}

.tick {
  position: absolute;
  font-size: 9px;
  color: var(--muted-color, #aaa);
  transform: translateX(-50%);
  font-family: monospace;
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--muted-color, #888);
  font-size: 13px;
}
</style>
