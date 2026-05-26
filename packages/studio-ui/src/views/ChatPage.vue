<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { fetchStudioAgents } from '../api/chat';
import { useChat } from '../composables/useChat';
import { useConstitution, useBudget, useWatchdog } from '../composables/useSelfModification';
import ChatMessage from '../components/ChatMessage.vue';
import ChatInput from '../components/ChatInput.vue';
import PipelineStageView from '../components/PipelineStageView.vue';
import ToolCallBlock from '../components/ToolCallBlock.vue';
import EventLog from '../components/EventLog.vue';
import type { StudioAgentDetail } from '../types';

const agentsQuery = useQuery({
  queryKey: ['studio-agents'],
  queryFn: fetchStudioAgents,
});

const agents = computed<StudioAgentDetail[]>(() => agentsQuery.data.value?.agents ?? []);

const selectedAgentId = ref<string | null>(null);
const activeSessionId = ref<string | null>(null);

const { messages, isStreaming, error, send, abort } = useChat(activeSessionId);

const { constitution } = useConstitution(selectedAgentId);
const { budget } = useBudget(selectedAgentId);
const { watchdog } = useWatchdog(selectedAgentId);

const rightTab = ref<'info' | 'observability'>('info');

const pipelineStages = computed(() => {
  if (!isStreaming.value) return [];
  return [
    { name: 'processInput', status: 'completed' as const },
    { name: 'buildContext', status: 'completed' as const },
    { name: 'prepareStep', status: 'completed' as const },
    { name: 'invokeLLM', status: 'running' as const },
    { name: 'processStepOutput', status: 'pending' as const },
    { name: 'executeTools', status: 'pending' as const },
    { name: 'evaluateIteration', status: 'pending' as const },
    { name: 'processOutput', status: 'pending' as const },
  ];
});

const toolCalls = computed(() => {
  return messages.value
    .filter(m => m.role === 'assistant' && m.content.includes('[Tool:'))
    .map(m => ({
      name: (m.content.match(/\[Tool: ([^\]]+)\]/) ?? ['', 'unknown'])[1],
      status: m.content.includes('[Result:') ? 'completed' as const : 'running' as const,
      result: m.content.includes('[Result:')
        ? (m.content.match(/\[Result: ([^\]]+)\]/) ?? ['', ''])[1]
        : undefined,
    }));
});

const sessionEvents = computed(() => {
  return messages.value.map(m => ({
    type: m.role === 'user' ? 'user:message' : 'agent:response',
    timestamp: m.timestamp,
    payload: m.content.slice(0, 80),
  }));
});

const messagesContainer = ref<HTMLElement | null>(null);

function selectAgent(agent: StudioAgentDetail) {
  selectedAgentId.value = agent.id;
  activeSessionId.value = `session-${agent.id}-${Date.now()}`;
}

async function scrollToBottom() {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

watch(messages, () => scrollToBottom(), { deep: true });

const selectedAgent = computed(() =>
  agents.value.find(a => a.id === selectedAgentId.value),
);
</script>

<template>
  <div class="chat-page">
    <!-- Left: Agent List -->
    <aside class="agent-panel">
      <h3 class="panel-title">Agents</h3>
      <div v-if="agentsQuery.isLoading.value" class="panel-hint">Loading...</div>
      <div v-else-if="agents.length === 0" class="panel-hint">No agents available</div>
      <div v-else class="agent-list">
        <button
          v-for="agent in agents"
          :key="agent.id"
          :class="['agent-item', { active: selectedAgentId === agent.id }]"
          @click="selectAgent(agent)"
        >
          <div class="agent-name">{{ agent.name }}</div>
          <div class="agent-model">{{ agent.model }}</div>
          <span :class="['agent-state', agent.state]">{{ agent.state }}</span>
        </button>
      </div>
    </aside>

    <!-- Center: Chat -->
    <div class="chat-main">
      <template v-if="activeSessionId">
        <div class="chat-header">
          <span class="chat-agent-name">{{ selectedAgent?.name ?? 'Agent' }}</span>
          <span v-if="isStreaming" class="streaming-badge">Streaming...</span>
          <button v-if="isStreaming" class="abort-btn" @click="abort">Abort</button>
        </div>
        <div ref="messagesContainer" class="messages-area">
          <ChatMessage
            v-for="msg in messages"
            :key="msg.id"
            :message="msg"
          />
          <div v-if="messages.length === 0" class="empty-hint">
            Start a conversation with {{ selectedAgent?.name ?? 'the agent' }}
          </div>
        </div>
        <div v-if="error" class="chat-error">{{ error }}</div>
        <ChatInput :disabled="isStreaming" @send="send" />
      </template>
      <div v-else class="no-agent-selected">
        <p>Select an agent to start chatting</p>
      </div>
    </div>

    <!-- Right: Info + Observability -->
    <aside v-if="selectedAgent" class="info-panel">
      <div class="tab-bar">
        <button :class="['tab-btn', { active: rightTab === 'info' }]" @click="rightTab = 'info'">Info</button>
        <button :class="['tab-btn', { active: rightTab === 'observability' }]" @click="rightTab = 'observability'">Observe</button>
      </div>

      <template v-if="rightTab === 'info'">
        <div class="info-section">
          <div class="info-label">Name</div>
          <div class="info-value">{{ selectedAgent.name }}</div>
        </div>
        <div class="info-section">
          <div class="info-label">Model</div>
          <div class="info-value">{{ selectedAgent.model }}</div>
        </div>
        <div class="info-section">
          <div class="info-label">State</div>
          <div class="info-value">{{ selectedAgent.state }}</div>
        </div>
        <div class="info-section">
          <div class="info-label">Tools</div>
          <div class="info-value">{{ selectedAgent.toolCount }}</div>
        </div>
        <div v-if="selectedAgent.description" class="info-section">
          <div class="info-label">Description</div>
          <div class="info-value desc">{{ selectedAgent.description }}</div>
        </div>
        <hr class="divider" />
        <h3 class="panel-title">Session</h3>
        <div class="info-section">
          <div class="info-label">Messages</div>
          <div class="info-value">{{ messages.length }}</div>
        </div>
        <div class="info-section">
          <div class="info-label">Status</div>
          <div class="info-value">{{ isStreaming ? 'Running' : 'Idle' }}</div>
        </div>
        <template v-if="budget">
          <hr class="divider" />
          <h3 class="panel-title">Mutation Budget</h3>
          <div class="info-section">
            <div class="info-label">Hourly</div>
            <div class="info-value">{{ budget.state.hourlyCount }} / {{ budget.config.maxMutationsPerHour }}</div>
          </div>
          <div class="info-section">
            <div class="info-label">Daily</div>
            <div class="info-value">{{ budget.state.dailyCount }} / {{ budget.config.maxMutationsPerDay }}</div>
          </div>
        </template>
      </template>

      <template v-else>
        <section class="observe-section">
          <h4 class="section-label">Pipeline</h4>
          <PipelineStageView :stages="pipelineStages" />
        </section>

        <section class="observe-section">
          <h4 class="section-label">Tool Calls</h4>
          <ToolCallBlock :tool-calls="toolCalls" />
        </section>

        <section class="observe-section">
          <h4 class="section-label">Event Log</h4>
          <EventLog :events="sessionEvents" :max-items="30" />
        </section>

        <template v-if="constitution">
          <section class="observe-section">
            <h4 class="section-label">Constitution</h4>
            <div class="info-section">
              <div class="info-label">Protected Paths</div>
              <div class="info-value">{{ constitution.protectedPaths.length }}</div>
            </div>
            <div class="info-section">
              <div class="info-label">Risk Levels</div>
              <div class="info-value">{{ Object.keys(constitution.approvalMatrix).join(', ') }}</div>
            </div>
          </section>
        </template>

        <template v-if="watchdog">
          <section class="observe-section">
            <h4 class="section-label">Watchdog</h4>
            <div class="info-section">
              <div class="info-label">Consecutive Failures</div>
              <div :class="['info-value', { warn: watchdog.state.consecutiveFailures > 0 }]">{{ watchdog.state.consecutiveFailures }}</div>
            </div>
            <div class="info-section">
              <div class="info-label">Total Rollbacks</div>
              <div class="info-value">{{ watchdog.state.totalRollbacks }}</div>
            </div>
          </section>
        </template>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  height: 100%;
  gap: 0;
}

.agent-panel {
  width: 220px;
  border-right: 1px solid var(--border-color, #e0e0e0);
  background: var(--panel-bg, #fafafa);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.panel-title {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-secondary, #666);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.panel-hint {
  padding: 16px;
  color: var(--text-secondary, #888);
  font-size: 13px;
}

.agent-list {
  overflow-y: auto;
  flex: 1;
}

.agent-item {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border-color, #eee);
  padding: 10px 16px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.agent-item:hover {
  background: var(--hover-bg, #f0f0f0);
}

.agent-item.active {
  background: var(--active-bg, #e8f0fe);
}

.agent-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #111);
}

.agent-model {
  font-size: 12px;
  color: var(--text-secondary, #888);
  margin-top: 2px;
}

.agent-state {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  margin-top: 4px;
  font-weight: 600;
}

.agent-state.running { background: #dcfce7; color: #166534; }
.agent-state.pending { background: #fef9c3; color: #854d0e; }
.agent-state.idle { background: #f3f4f6; color: #6b7280; }

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--panel-bg, #fafafa);
}

.chat-agent-name {
  font-weight: 600;
  font-size: 15px;
}

.streaming-badge {
  font-size: 12px;
  color: var(--streaming-color, #3b82f6);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.abort-btn {
  margin-left: auto;
  padding: 4px 12px;
  border: 1px solid #dc2626;
  border-radius: 4px;
  background: none;
  color: #dc2626;
  font-size: 12px;
  cursor: pointer;
}

.abort-btn:hover {
  background: #dc2626;
  color: #fff;
}

.messages-area {
  flex: 1;
  overflow-y: auto;
  background: var(--chat-bg, #fff);
}

.empty-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #aaa);
  font-size: 14px;
}

.no-agent-selected {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #aaa);
  font-size: 15px;
}

.chat-error {
  padding: 8px 16px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 13px;
  border-top: 1px solid #fecaca;
}

.info-panel {
  width: 240px;
  border-left: 1px solid var(--border-color, #e0e0e0);
  background: var(--panel-bg, #fafafa);
  flex-shrink: 0;
  overflow-y: auto;
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.tab-btn {
  flex: 1;
  padding: 8px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #888);
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}

.tab-btn.active {
  color: var(--text-primary, #111);
  border-bottom-color: #3b82f6;
}

.observe-section {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color, #eee);
}

.section-label {
  margin: 0;
  padding: 4px 16px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-secondary, #888);
}

.info-value.warn {
  color: #f59e0b;
  font-weight: 600;
}

.info-section {
  padding: 8px 16px;
}

.info-label {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-secondary, #888);
  margin-bottom: 2px;
}

.info-value {
  font-size: 14px;
  color: var(--text-primary, #111);
}

.info-value.desc {
  font-size: 13px;
  line-height: 1.4;
}

.divider {
  border: none;
  border-top: 1px solid var(--border-color, #e0e0e0);
  margin: 8px 0;
}
</style>
