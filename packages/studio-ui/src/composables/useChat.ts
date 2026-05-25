import { ref, computed, onUnmounted, watch, type Ref } from 'vue';
import { sendChatMessage, abortSession, createEventSource } from '../api/chat';
import type { ChatMessage, SSEEvent } from '../types';

let msgCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

export function useChat(sessionId: Ref<string | null>) {
  const messages = ref<ChatMessage[]>([]);
  const isStreaming = ref(false);
  const error = ref<string | null>(null);
  let eventSource: EventSource | null = null;

  const lastAssistantMsg = computed(() => {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'assistant') return messages.value[i];
    }
    return null;
  });

  function addUserMessage(content: string) {
    messages.value.push({
      id: nextId(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    });
  }

  function addAssistantPlaceholder(): ChatMessage {
    const msg: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };
    messages.value.push(msg);
    return msg;
  }

  function handleSSEEvent(event: SSEEvent) {
    const target = lastAssistantMsg.value;
    if (!target || !target.isStreaming) return;

    switch (event.type) {
      case 'token':
        target.content += (event.data as { token: string }).token;
        break;
      case 'tool_call':
        target.content += `\n[Tool: ${(event.data as { name: string }).name}]\n`;
        break;
      case 'tool_result':
        target.content += `[Result: ${JSON.stringify((event.data as { result: unknown }).result)}]\n`;
        break;
      case 'done':
        target.isStreaming = false;
        isStreaming.value = false;
        break;
      case 'error':
        target.content += `\n[Error: ${(event.data as { message: string }).message}]`;
        target.isStreaming = false;
        isStreaming.value = false;
        error.value = (event.data as { message: string }).message;
        break;
    }
  }

  function connectSSE(sid: string) {
    disconnectSSE();
    eventSource = createEventSource(sid);
    eventSource.onmessage = (e) => {
      try {
        const parsed: SSEEvent = JSON.parse(e.data);
        handleSSEEvent(parsed);
      } catch { /* ignore non-JSON events */ }
    };
    eventSource.onerror = () => {
      disconnectSSE();
    };
  }

  function disconnectSSE() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  async function send(content: string) {
    if (!sessionId.value || isStreaming.value) return;

    error.value = null;
    addUserMessage(content);
    addAssistantPlaceholder();
    isStreaming.value = true;

    connectSSE(sessionId.value);

    try {
      const stream = await sendChatMessage(sessionId.value, content);
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const target = lastAssistantMsg.value;
        if (target?.isStreaming) target.content += text;
      }

      const target = lastAssistantMsg.value;
      if (target?.isStreaming) {
        target.isStreaming = false;
        isStreaming.value = false;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      error.value = msg;
      const target = lastAssistantMsg.value;
      if (target?.isStreaming) {
        target.content += `\n[Error: ${msg}]`;
        target.isStreaming = false;
      }
      isStreaming.value = false;
    }
  }

  async function abort() {
    if (!sessionId.value) return;
    disconnectSSE();
    try {
      await abortSession(sessionId.value);
    } catch { /* ignore abort errors */ }
    const target = lastAssistantMsg.value;
    if (target?.isStreaming) {
      target.isStreaming = false;
      target.content += '\n[Aborted]';
    }
    isStreaming.value = false;
  }

  watch(sessionId, (newId) => {
    messages.value = [];
    error.value = null;
    isStreaming.value = false;
    if (newId) connectSSE(newId);
    else disconnectSSE();
  });

  onUnmounted(() => {
    disconnectSSE();
  });

  return {
    messages,
    isStreaming,
    error,
    send,
    abort,
  };
}
