/**
 * AgentForge Compaction Strategies
 *
 * Implements compaction strategies for context window management.
 *
 * Strategies:
 * - truncate-oldest: Remove oldest messages beyond preserveRecent
 * - summarize: Use LLM to summarize removed messages
 * - importance-weighted: Keep messages based on importance (fallback to truncate)
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/14-OBSERVABILITY.md
 */

import { z } from 'zod';
import type { Message } from '../core/events.js';
import type { LLMAdapter } from '../core/interfaces.js';

// ============================================================
// Compaction Strategy Types
// ============================================================

/**
 * Compaction strategy enumeration
 */
export const CompactionStrategySchema = z.enum([
  'truncate-oldest',
  'summarize',
  'importance-weighted',
]);

export type CompactionStrategy = z.infer<typeof CompactionStrategySchema>;

/**
 * Compaction result
 */
export const CompactionResultSchema = z.object({
  /** Compacted message array */
  messages: z.array(z.any()), // Message array - using z.any() to avoid circular dependency

  /** Number of messages removed */
  removedCount: z.number(),

  /** Number of messages summarized (for summarize strategy) */
  summarizedCount: z.number().optional(),

  /** Token count before compaction */
  tokensBefore: z.number(),

  /** Token count after compaction */
  tokensAfter: z.number(),

  /** Strategy used */
  strategy: CompactionStrategySchema,

  /** Summary text (for summarize strategy) */
  summary: z.string().optional(),
});

export type CompactionResult = z.infer<typeof CompactionResultSchema>;

// ============================================================
// Token Estimation
// ============================================================

/**
 * Estimate token count for messages
 *
 * Simple approximation: 1 token ≈ 4 characters
 * This is a rough estimate; actual tokenization varies by model.
 *
 * @param messages - Message array to estimate
 * @returns Estimated token count
 */
export function estimateTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

/**
 * Estimate token count for a single message
 */
export function estimateMessageTokens(message: Message): number {
  return Math.ceil(message.content.length / 4);
}

// ============================================================
// Preserve Configuration
// ============================================================

export interface PreserveConfig {
  /** Keep system prompt message */
  systemPrompt?: boolean;

  /** Keep last N user messages */
  lastNUserMessages?: number;

  /** Keep last N tool results */
  lastNToolResults?: number;

  /** Additional messages to preserve by index */
  preserveIndices?: number[];
}

const DEFAULT_PRESERVE_CONFIG: Required<PreserveConfig> = {
  systemPrompt: true,
  lastNUserMessages: 5,
  lastNToolResults: 10,
  preserveIndices: [],
};

// ============================================================
// Truncate Oldest Strategy
// ============================================================

/**
 * Truncate oldest messages beyond preserve threshold
 *
 * This is the simplest strategy - removes oldest messages while
 * preserving the system prompt and recent messages.
 *
 * @param messages - Original message array
 * @param preserveRecent - Number of recent messages to preserve
 * @param config - Additional preservation configuration
 * @returns Compaction result
 */
export function truncateOldest(
  messages: Message[],
  preserveRecent: number,
  config: PreserveConfig = {}
): CompactionResult {
  const tokensBefore = estimateTokens(messages);
  const cfg = { ...DEFAULT_PRESERVE_CONFIG, ...config };

  if (messages.length <= preserveRecent) {
    // No compaction needed
    return {
      messages: [...messages],
      removedCount: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
      strategy: 'truncate-oldest',
    };
  }

  // Identify indices to preserve
  const preserveIndices = new Set<number>(cfg.preserveIndices);

  // Preserve system prompt (first message if role is 'system')
  if (cfg.systemPrompt && messages.length > 0 && messages[0]?.role === 'system') {
    preserveIndices.add(0);
  }

  // Preserve last N user messages
  if (cfg.lastNUserMessages > 0) {
    const userIndices: number[] = [];
    for (let i = messages.length - 1; i >= 0 && userIndices.length < cfg.lastNUserMessages; i--) {
      if (messages[i]?.role === 'user') {
        userIndices.push(i);
      }
    }
    userIndices.forEach(idx => preserveIndices.add(idx));
  }

  // Preserve last N tool results
  if (cfg.lastNToolResults > 0) {
    const toolIndices: number[] = [];
    for (let i = messages.length - 1; i >= 0 && toolIndices.length < cfg.lastNToolResults; i--) {
      if (messages[i]?.role === 'tool') {
        toolIndices.push(i);
      }
    }
    toolIndices.forEach(idx => preserveIndices.add(idx));
  }

  // Always preserve last preserveRecent messages
  for (let i = Math.max(0, messages.length - preserveRecent); i < messages.length; i++) {
    preserveIndices.add(i);
  }

  // Build compacted messages
  const compacted: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    // Check if this index should be preserved
    if (preserveIndices.has(i)) {
      compacted.push(messages[i]!);
    }
  }

  const tokensAfter = estimateTokens(compacted);

  return {
    messages: compacted,
    removedCount: messages.length - compacted.length,
    tokensBefore,
    tokensAfter,
    strategy: 'truncate-oldest',
  };
}

// ============================================================
// Summarize Strategy
// ============================================================

/**
 * Summarization prompt template
 */
const SUMMARIZATION_PROMPT = `Summarize the following conversation history concisely. Focus on key decisions, important context, and any unresolved questions. Keep the summary under {maxLength} characters.

---

{history}

---

Summary:`;

/**
 * Create a summary message from removed content
 */
function createSummaryMessage(summary: string): Message {
  return {
    role: 'system',
    content: `[Conversation Summary]\n${summary}`,
    name: 'compaction-summary',
  };
}

/**
 * Summarize strategy using LLM
 *
 * Removes old messages and creates a summary that is prepended
 * as a system message. Falls back to truncate-oldest on error.
 *
 * @param messages - Original message array
 * @param preserveRecent - Number of recent messages to preserve
 * @param llmAdapter - LLM adapter for summarization
 * @param maxSummaryLength - Maximum summary length in characters
 * @returns Compaction result
 */
export async function summarize(
  messages: Message[],
  preserveRecent: number,
  llmAdapter: LLMAdapter,
  maxSummaryLength = 500
): Promise<CompactionResult> {
  const tokensBefore = estimateTokens(messages);

  if (messages.length <= preserveRecent) {
    return {
      messages: [...messages],
      removedCount: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
      strategy: 'summarize',
    };
  }

  // Identify messages to summarize (all except recent ones)
  const toSummarize = messages.slice(0, messages.length - preserveRecent);
  const recentMessages = messages.slice(messages.length - preserveRecent);

  // Build history string for summarization
  const historyText = toSummarize
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n\n');

  const prompt = SUMMARIZATION_PROMPT
    .replace('{maxLength}', String(maxSummaryLength))
    .replace('{history}', historyText);

  try {
    // Call LLM for summarization
    const response = await llmAdapter.chat([
      { role: 'user', content: prompt },
    ]);

    const summary = response.content.slice(0, maxSummaryLength);
    const summaryMessage = createSummaryMessage(summary);

    // Build final messages: summary + recent
    const compacted = [summaryMessage, ...recentMessages];
    const tokensAfter = estimateTokens(compacted);

    return {
      messages: compacted,
      removedCount: toSummarize.length,
      summarizedCount: toSummarize.length,
      tokensBefore,
      tokensAfter,
      strategy: 'summarize',
      summary,
    };
  } catch {
    // Fallback to truncate-oldest on LLM error
    return truncateOldest(messages, preserveRecent);
  }
}

// ============================================================
// Importance-Weighted Strategy
// ============================================================

/**
 * Importance score for a message
 */
export interface MessageImportance {
  index: number;
  score: number;
  reason: string;
}

/**
 * Calculate importance score for a message
 *
 * Simple heuristic-based scoring:
 * - System messages: high importance
 * - User messages: medium importance
 * - Tool results with errors: higher importance
 * - Recent messages: higher importance
 */
function calculateImportance(message: Message, index: number, total: number): MessageImportance {
  let score = 50; // Base score
  const reasons: string[] = [];

  // Role-based scoring
  if (message.role === 'system') {
    score += 40;
    reasons.push('system-message');
  } else if (message.role === 'user') {
    score += 20;
    reasons.push('user-message');
  }

  // Recency scoring (recent messages are more important)
  const recencyBonus = Math.floor((index / total) * 20);
  score += recencyBonus;
  if (recencyBonus > 10) {
    reasons.push('recent');
  }

  // Tool error detection
  if (message.role === 'tool' && message.content.toLowerCase().includes('error')) {
    score += 15;
    reasons.push('contains-error');
  }

  return {
    index,
    score: Math.min(100, score),
    reason: reasons.join(', '),
  };
}

/**
 * Importance-weighted strategy
 *
 * Keeps messages based on importance score.
 * Currently implements a simple heuristic; falls back to truncate-oldest.
 *
 * @param messages - Original message array
 * @param preserveRecent - Number of minimum recent messages to preserve
 * @param targetTokenCount - Target token count after compaction
 * @returns Compaction result
 */
export function importanceWeighted(
  messages: Message[],
  preserveRecent: number,
  targetTokenCount: number
): CompactionResult {
  const tokensBefore = estimateTokens(messages);

  if (messages.length <= preserveRecent) {
    return {
      messages: [...messages],
      removedCount: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
      strategy: 'importance-weighted',
    };
  }

  // Calculate importance scores
  const importanceScores = messages.map((m, i) => calculateImportance(m, i, messages.length));

  // Always preserve last N messages
  const recentStartIndex = Math.max(0, messages.length - preserveRecent);
  for (let i = recentStartIndex; i < messages.length; i++) {
    importanceScores[i]!.score = 1000; // Guarantee preservation
  }

  // Sort by importance (descending)
  const sortedByImportance = [...importanceScores].sort((a, b) => b.score - a.score);

  // Select messages until we reach target token count
  const selectedIndices = new Set<number>();
  let currentTokens = 0;

  for (const item of sortedByImportance) {
    if (currentTokens >= targetTokenCount) {
      break;
    }
    selectedIndices.add(item.index);
    currentTokens += estimateMessageTokens(messages[item.index]!);
  }

  // Ensure we maintain message order
  const compacted = messages
    .filter((_, i) => selectedIndices.has(i))
    .sort((a, b) => {
      const aIdx = messages.indexOf(a);
      const bIdx = messages.indexOf(b);
      return aIdx - bIdx;
    });

  const tokensAfter = estimateTokens(compacted);

  return {
    messages: compacted,
    removedCount: messages.length - compacted.length,
    tokensBefore,
    tokensAfter,
    strategy: 'importance-weighted',
  };
}
