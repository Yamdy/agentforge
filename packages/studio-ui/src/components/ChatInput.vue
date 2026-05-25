<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{ send: [content: string] }>();
defineProps<{ disabled?: boolean }>();

const input = ref('');

function handleSubmit() {
  const text = input.value.trim();
  if (!text) return;
  emit('send', text);
  input.value = '';
}
</script>

<template>
  <form class="chat-input" @submit.prevent="handleSubmit">
    <textarea
      v-model="input"
      class="chat-textarea"
      placeholder="Type a message..."
      :disabled="disabled"
      rows="1"
      @keydown.enter.exact.prevent="handleSubmit"
    />
    <button
      type="submit"
      class="send-btn"
      :disabled="disabled || !input.trim()"
    >
      Send
    </button>
  </form>
</template>

<style scoped>
.chat-input {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  background: var(--input-bar-bg, #fff);
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.chat-textarea {
  flex: 1;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #111);
  outline: none;
}

.chat-textarea:focus {
  border-color: var(--focus-border, #3b82f6);
}

.send-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  background: var(--btn-primary-bg, #3b82f6);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-end;
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
