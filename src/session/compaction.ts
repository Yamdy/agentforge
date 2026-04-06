import type { Session, SessionMessage } from './storage.js';

export interface CompactionOptions {
  maxMessages?: number;
  keepFirst?: number;
  keepLast?: number;
  summaryPrompt?: string;
}

export interface CompactionResult {
  originalCount: number;
  compactedCount: number;
  summary: string;
}

export async function compactSession(
  session: Session,
  options: CompactionOptions = {}
): Promise<CompactionResult> {
  const maxMessages = options.maxMessages ?? 50;
  const keepFirst = options.keepFirst ?? 2;
  const keepLast = options.keepLast ?? 10;

  if (session.messages.length <= maxMessages) {
    return {
      originalCount: session.messages.length,
      compactedCount: session.messages.length,
      summary: 'No compaction needed',
    };
  }

  const systemMessages = session.messages.filter(m => m.role === 'system');
  const nonSystemMessages = session.messages.filter(m => m.role !== 'system');

  const firstMessages = nonSystemMessages.slice(0, keepFirst);
  const lastMessages = nonSystemMessages.slice(-keepLast);
  const middleMessages = nonSystemMessages.slice(keepFirst, nonSystemMessages.length - keepLast);

  let summary = `Session had ${middleMessages.length} intermediate messages.`;
  
  if (middleMessages.length > 0) {
    summary += ` The conversation covered ${middleMessages.length} exchanges between user and assistant.`;
  }

  const compacted: SessionMessage[] = [
    ...systemMessages,
    ...firstMessages,
    { role: 'system', content: `[Previous conversation summary: ${summary}]` },
    ...lastMessages,
  ];

  return {
    originalCount: session.messages.length,
    compactedCount: compacted.length,
    summary,
  };
}

export function applyCompaction(
  session: Session,
  compactedMessages: SessionMessage[]
): Session {
  return {
    ...session,
    messages: compactedMessages,
    compactedAt: Date.now(),
  };
}
