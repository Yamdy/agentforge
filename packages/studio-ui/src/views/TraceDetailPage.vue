<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTrace } from '../composables/useTraces';
import SpanTimeline from '../components/SpanTimeline.vue';
import type { SpanNode } from '../types';

const route = useRoute();
const router = useRouter();
const traceId = route.params.id as string;
const { trace, isLoading } = useTrace(traceId);

const selectedSpanId = ref<string | null>(null);
const selectedSpan = ref<SpanNode | null>(null);

function onSpanSelect(span: SpanNode): void {
  selectedSpan.value = span;
}
</script>

<template>
  <div class="trace-detail">
    <button class="back-btn" @click="router.push('/traces')">&larr; Back to Traces</button>

    <div v-if="isLoading" class="loading">Loading trace...</div>
    <template v-else-if="trace">
      <h2>Trace: {{ trace.id.slice(0, 12) }}...</h2>
      <div class="info-grid">
        <div class="info-item">
          <span class="label">Agent</span>
          <span class="value">{{ trace.agentName }}</span>
        </div>
        <div class="info-item">
          <span class="label">Status</span>
          <span class="value">{{ trace.status }}</span>
        </div>
        <div class="info-item">
          <span class="label">Duration</span>
          <span class="value">{{ trace.duration }}ms</span>
        </div>
        <div class="info-item">
          <span class="label">Tokens</span>
          <span class="value">{{ trace.tokenTotal.toLocaleString() }}</span>
        </div>
        <div class="info-item">
          <span class="label">Cost</span>
          <span class="value">${{ trace.costEstimated.toFixed(4) }}</span>
        </div>
        <div class="info-item">
          <span class="label">Started</span>
          <span class="value">{{ new Date(trace.startTime).toLocaleString() }}</span>
        </div>
      </div>

      <section class="section">
        <h3>Span Timeline</h3>
        <div class="timeline-layout">
          <div class="timeline-main">
            <SpanTimeline
              :root-span="trace.rootSpan"
              :trace-duration="trace.duration"
              v-model:selected-span-id="selectedSpanId"
              @select="onSpanSelect"
            />
          </div>
          <div class="detail-panel" v-if="selectedSpan">
            <h4>Span Details</h4>
            <div class="span-info">
              <div class="info-row">
                <span class="label">Name</span>
                <span class="value">{{ selectedSpan.span.name }}</span>
              </div>
              <div class="info-row">
                <span class="label">Duration</span>
                <span class="value">{{ selectedSpan.span.durationMs }}ms</span>
              </div>
              <div class="info-row">
                <span class="label">Span ID</span>
                <span class="value cell-mono">{{ selectedSpan.span.spanId.slice(0, 12) }}...</span>
              </div>
            </div>
            <div class="span-attrs" v-if="Object.keys(selectedSpan.span.attributes).length">
              <h5>Attributes</h5>
              <div class="attr-row" v-for="(v, k) in selectedSpan.span.attributes" :key="k">
                <code class="attr-key">{{ k }}</code>
                <span class="attr-val">{{ v }}</span>
              </div>
            </div>
          </div>
          <div class="detail-panel detail-empty" v-else>
            <p class="muted">Select a span to view details.</p>
          </div>
        </div>
      </section>
    </template>
    <div v-else class="not-found">Trace not found.</div>
  </div>
</template>

<style scoped>
.trace-detail {
  max-width: 1000px;
}

.back-btn {
  background: none;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
  margin-bottom: 20px;
}

.back-btn:hover {
  background: var(--hover-bg, #f0f0f0);
}

h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 20px;
}

.loading,
.not-found {
  padding: 20px;
  color: var(--muted-color, #888);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.info-item {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  padding: 12px;
}

.label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--muted-color, #888);
  margin-bottom: 4px;
}

.value {
  font-size: 14px;
  font-weight: 600;
}

.section {
  margin-bottom: 24px;
}

h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 12px;
}

.placeholder {
  color: var(--muted-color, #888);
  padding: 20px;
  background: var(--card-bg, #ffffff);
  border: 1px dashed var(--border-color, #e0e0e0);
  border-radius: 6px;
  text-align: center;
}

.timeline-layout {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
}

.timeline-main {
  flex: 1;
  min-width: 0;
}

.timeline-main .timeline-container {
  border: none;
  border-radius: 0;
}

.detail-panel {
  width: 280px;
  flex-shrink: 0;
  padding: 16px;
  background: var(--bg-secondary, #fafafa);
  border-left: 1px solid var(--border-color, #e0e0e0);
  overflow-y: auto;
  max-height: 520px;
}

.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.muted {
  color: var(--muted-color, #888);
  font-size: 13px;
}

.detail-panel h4 {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  margin: 0 0 12px;
  color: var(--muted-color, #888);
}

.detail-panel h5 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--muted-color, #888);
  margin: 16px 0 8px;
}

.span-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.info-row .label {
  margin-bottom: 0;
}

.info-row .value {
  font-size: 12px;
}

.span-attrs {
  margin-top: 8px;
}

.attr-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 11px;
}

.attr-key {
  font-size: 10px;
  color: var(--muted-color, #888);
  background: var(--card-bg, #fff);
  padding: 1px 4px;
  border-radius: 3px;
}

.attr-val {
  font-weight: 500;
}
</style>
