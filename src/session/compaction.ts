import type { Session, SessionMessage } from './storage.js';
import type { LLMAdapter } from '../types.js';
import type { PluginManager } from '../plugin/index.js';

export interface CompactionOptions {
  maxMessages?: number;
  keepFirst?: number;
  keepLast?: number;
  summaryPrompt?: string;
  llmAdapter?: LLMAdapter;
  pluginManager?: PluginManager;
  sessionId?: string;
}

export interface CompactionResult {
  originalCount: number;
  compactedCount: number;
  summary: string;
}

const DEFAULT_SUMMARY_PROMPT = `
Summarize the following conversation between a user and an AI assistant.
Focus on the key points, decisions, and important information that would be needed for continuing the conversation.
Keep the summary concise but comprehensive.
Conversation to summarize:
`;

export async function compactSession(
  session: Session,
  options: CompactionOptions = {}
): Promise<{
  originalCount: number;
  compactedMessages: SessionMessage[];
  summary: string;
}> {
  const maxMessages = options.maxMessages ?? 50;
  const keepFirst = options.keepFirst ?? 2;
  const keepLast = options.keepLast ?? 10;
  const summaryPrompt = options.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT;

  if (session.messages.length <= maxMessages) {
    return {
      originalCount: session.messages.length,
      compactedMessages: session.messages,
      summary: 'No compaction needed',
    };
  }

  const compactingOutput: { context: string[]; prompt?: string } = { context: [] };
  if (options.pluginManager) {
    await options.pluginManager.trigger('session.compacting', {
      sessionId: options.sessionId,
      messageCount: session.messages.length,
    }, compactingOutput);
  }

  if (compactingOutput.prompt) {
    options = { ...options, summaryPrompt: compactingOutput.prompt };
  }

  const systemMessages = session.messages.filter((m) => m.role === 'system');
  const nonSystemMessages = session.messages.filter((m) => m.role !== 'system');

  const firstMessages = nonSystemMessages.slice(0, keepFirst);
  const lastMessages = nonSystemMessages.slice(-keepLast);
  const middleMessages = nonSystemMessages.slice(keepFirst, nonSystemMessages.length - keepLast);

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

  const compacted: SessionMessage[] = [
    ...systemMessages,
    ...firstMessages,
    { role: 'system', content: `[Previous conversation summary]: ${summary}` },
    ...lastMessages,
  ];

  return {
    originalCount: session.messages.length,
    compactedMessages: compacted,
    summary,
  };
}

export function applyCompaction(session: Session, compactedMessages: SessionMessage[]): Session {
  return {
    ...session,
    messages: compactedMessages,
    compactedAt: Date.now(),
  };
}
