import type { Session, SessionMessage } from './storage.js';
import type { LLMAdapter } from '../types.js';
import type { PluginManager } from '../plugin/index.js';

export interface CompactionOptions {
  maxMessages?: number;
  maxTokens?: number;
  keepFirst?: number;
  keepLast?: number;
  summaryPrompt?: string;
  llmAdapter?: LLMAdapter;
  pluginManager?: PluginManager;
  sessionId?: string;
  /** 保留系统消息 */
  keepSystemMessages?: boolean;
  /** 保留工具结果 */
  keepToolResults?: boolean;
  /** 自动压缩阈值（token 数），超过后自动压缩 */
  autoCompactThreshold?: number;
  /** 是否总是保留当前目标 */
  preserveGoal?: boolean;
}

export interface CompactionResult {
  originalCount: number;
  compactedCount: number;
  summary: string;
  /** 节省的 token 数 */
  savedTokens: number;
}

const DEFAULT_SUMMARY_PROMPT = `
Summarize the following conversation between a user and an AI assistant.
Focus on the key points, decisions, and important information that would be needed for continuing the conversation.
Keep the summary concise but comprehensive.
Conversation to summarize:
`;

/**
 * 估算文本的 token 数
 * 简单实现：按字符数估算（平均 3 字符 = 1 token）
 * @param text 要估算的文本
 * @returns 估算的 token 数
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * 压缩消息列表
 * @param messages 消息列表
 * @param config 压缩配置
 * @returns 压缩结果
 */
export function compactMessages(
  messages: SessionMessage[],
  config: CompactionOptions
): {
  messages: SessionMessage[];
  originalCount: number;
  compactedCount: number;
  savedTokens: number;
} {
  const maxMessages = config.maxMessages ?? 50;
  const keepSystem = config.keepSystemMessages ?? true;
  const keepTools = config.keepToolResults ?? true;

  const originalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  if (messages.length <= maxMessages) {
    return {
      messages,
      originalCount: messages.length,
      compactedCount: messages.length,
      savedTokens: 0,
    };
  }

  // 分离需要保留的消息
  const toKeep: SessionMessage[] = [];
  const toCompact: SessionMessage[] = [];

  for (const msg of messages) {
    if (keepSystem && msg.role === 'system') {
      toKeep.push(msg);
    } else if (keepTools && msg.role === 'tool') {
      toKeep.push(msg);
    } else {
      toCompact.push(msg);
    }
  }

  // 保留最新的消息
  const remainingSlots = maxMessages - toKeep.length;
  const recentMessages = toCompact.slice(-Math.max(0, remainingSlots));

  const result = [...toKeep, ...recentMessages].sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
  );

  const compactedTokens = result.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  return {
    messages: result,
    originalCount: messages.length,
    compactedCount: result.length,
    savedTokens: originalTokens - compactedTokens,
  };
}

/**
 * Check if session needs compaction based on current options
 */
export function needsCompaction(messages: SessionMessage[], options: CompactionOptions): boolean {
  const maxMessages = options.maxMessages ?? Infinity;
  const maxTokens = options.maxTokens ?? Infinity;
  const threshold = options.autoCompactThreshold;

  // Check message count
  if (messages.length > maxMessages) {
    return true;
  }

  // Check token count against threshold
  if (threshold) {
    const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    if (totalTokens >= threshold) {
      return true;
    }
  }

  // Check absolute max tokens
  if (maxTokens < Infinity) {
    const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    if (totalTokens > maxTokens) {
      return true;
    }
  }

  return false;
}

export async function compactSession(
  session: Session,
  options: CompactionOptions = {}
): Promise<{
  originalCount: number;
  compactedMessages: SessionMessage[];
  summary: string;
  savedTokens: number;
}> {
  const keepFirst = options.keepFirst ?? 2;
  const keepLast = options.keepLast ?? 15;
  const summaryPrompt = options.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT;
  const preserveGoal = options.preserveGoal ?? true;

  if (!needsCompaction(session.messages, options)) {
    return {
      originalCount: session.messages.length,
      compactedMessages: session.messages,
      summary: 'No compaction needed',
      savedTokens: 0,
    };
  }

  const compactingOutput: { context: string[]; prompt?: string } = { context: [] };
  if (options.pluginManager) {
    await options.pluginManager.trigger(
      'session.compacting',
      {
        sessionId: options.sessionId,
        messageCount: session.messages.length,
      },
      compactingOutput
    );
  }

  if (compactingOutput.prompt) {
    options = { ...options, summaryPrompt: compactingOutput.prompt };
  }

  // Extract system messages
  const systemMessages = session.messages.filter((m) => m.role === 'system');
  const nonSystemMessages = session.messages.filter((m) => m.role !== 'system');

  // If preserving goal, look for user messages containing goal/objective/task keywords
  // and keep them at the beginning
  const goalMessages: SessionMessage[] = [];
  const remainingNonSystem = [...nonSystemMessages];

  if (preserveGoal) {
    // Look for goal-like messages in the first few messages
    const goalKeywords = ['goal', 'objective', 'task', 'target', 'goal:', 'task:'];
    for (let i = 0; i < Math.min(5, nonSystemMessages.length); i++) {
      const msg = nonSystemMessages[i];
      if (msg.role === 'user' && goalKeywords.some((k) => msg.content.toLowerCase().includes(k))) {
        goalMessages.push(msg);
        remainingNonSystem.splice(i - goalMessages.length + 1, 1);
      }
    }
  }

  const firstMessages = remainingNonSystem.slice(0, keepFirst);
  // Ensure we don't go out of bounds: if keepLast >= available messages, take all remaining
  const startSlice = Math.max(keepFirst, remainingNonSystem.length - keepLast);
  const lastMessages = remainingNonSystem.slice(startSlice);
  const middleMessages = remainingNonSystem.slice(keepFirst, startSlice);

  let summary: string;

  if (options.llmAdapter && middleMessages.length > 0) {
    const conversationText = middleMessages
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join('\n\n');
    let prompt = `${summaryPrompt}\n\n${conversationText}`;
    if (compactingOutput.context.length > 0) {
      prompt = `${compactingOutput.context.join('\n\n')}\n\n${prompt}`;
    }
    const result = await options.llmAdapter.chat([{ role: 'user', content: prompt }]);
    summary = result.content ?? JSON.stringify(result);
  } else {
    // Fallback to simple summary
    summary = `Session had ${middleMessages.length} intermediate messages that were compacted. `;
    if (middleMessages.length > 0) {
      summary += `The conversation covered ${middleMessages.length} exchanges.`;
    }
  }

  const originalTokens = session.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  // Build compacted array with smart ordering
  const compacted: SessionMessage[] = [
    ...systemMessages,
    ...goalMessages,
    ...firstMessages,
    { role: 'system', content: `[Previous conversation summary]: ${summary}` },
    ...lastMessages,
  ];

  const compactedTokens = compacted.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  return {
    originalCount: session.messages.length,
    compactedMessages: compacted,
    summary,
    savedTokens: originalTokens - compactedTokens,
  };
}

export function applyCompaction(session: Session, compactedMessages: SessionMessage[]): Session {
  return {
    ...session,
    messages: compactedMessages,
    compactedAt: Date.now(),
  };
}
