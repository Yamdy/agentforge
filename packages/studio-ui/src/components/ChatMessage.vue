<script setup lang="ts">
import type { ChatMessage } from '../types';

defineProps<{ message: ChatMessage }>();
</script>

<template>
  <div :class="['chat-message', message.role]">
    <div class="message-avatar">
      {{ message.role === 'user' ? 'U' : 'A' }}
    </div>
    <div class="message-body">
      <div class="message-meta">
        <span class="message-role">{{ message.role === 'user' ? 'You' : 'Agent' }}</span>
        <span class="message-time">{{ new Date(message.timestamp).toLocaleTimeString() }}</span>
      </div>
      <div class="message-content">
        <pre class="message-text">{{ message.content }}</pre>
        <span v-if="message.isStreaming" class="cursor">|</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-message {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
}

.chat-message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}

.chat-message.user .message-avatar {
  background: var(--avatar-user-bg, #3b82f6);
  color: #fff;
}

.chat-message.assistant .message-avatar {
  background: var(--avatar-agent-bg, #10b981);
  color: #fff;
}

.message-body {
  max-width: 75%;
  min-width: 0;
}

.chat-message.user .message-body {
  align-items: flex-end;
}

.message-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-secondary, #888);
}

.chat-message.user .message-meta {
  justify-content: flex-end;
}

.message-content {
  background: var(--message-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  padding: 10px 14px;
  display: flex;
  align-items: flex-start;
}

.chat-message.user .message-content {
  background: var(--message-user-bg, #eff6ff);
}

.message-text {
  margin: 0;
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.5;
}

.cursor {
  animation: blink 0.8s step-end infinite;
  font-weight: 700;
}

@keyframes blink {
  50% { opacity: 0; }
}
</style>
