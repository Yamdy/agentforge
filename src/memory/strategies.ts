/**
 * AgentForge Compaction Strategies
 *
 * Implements compaction strategies for context window management.
 *
 * Strategies:
 * - truncate-oldest: Remove oldest messages beyond preserveRecent
 * - summarize: Use LLM to summarize removed messages
 * - importance-weighted: Keep messages based on importance (fallback to truncate)
 * - snip: Keep last N conversation turns
 * - pointer-indexed: Index removed messages in VectorStore, replace with pointer
 *
 */

import { z } from 'zod';
import type { Message } from '../core/events.js';
import type { LLMAdapter } from '../core/interfaces.js';
import { countMessagesTokens } from '../token-counter.js';
import { extractText } from '../core/content-utils.js';
import type { VectorStore, VectorDocument } from './vector-store.js';
import type { EmbeddingModel } from './embedding.js';

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
  'snip',
  'pointer-indexed',
  'microcompact',
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

  /** Number of messages trimmed in-place (microcompact strategy) */
  trimmedCount: z.number().optional(),
});

export type CompactionResult = z.infer<typeof CompactionResultSchema>;

// ============================================================
// Token Estimation
// ============================================================

/**
 * Estimate token count for messages
 *
 * Uses js-tiktoken for accurate tokenization when available,
 * falls back to heuristic for non-OpenAI models.
 *
 * @param messages - Message array to estimate
 * @returns Estimated token count
 */
export function estimateTokens(messages: Message[]): number {
  return countMessagesTokens(messages);
}

/**
 * Estimate token count for a single message
 */
export function estimateMessageTokens(message: Message): number {
  return countMessagesTokens([message]);
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
  const historyText = toSummarize.map(m => `[${m.role}]: ${extractText(m.content)}`).join('\n\n');

  const prompt = SUMMARIZATION_PROMPT.replace('{maxLength}', String(maxSummaryLength)).replace(
    '{history}',
    historyText
  );

  try {
    // Call LLM for summarization
    const response = await llmAdapter.chat([{ role: 'user', content: prompt }]);

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
  if (message.role === 'tool' && extractText(message.content).toLowerCase().includes('error')) {
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

  // Ensure we maintain message order (O(n) instead of O(n²))
  const compacted: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (selectedIndices.has(i)) {
      compacted.push(messages[i]!);
    }
  }

  const tokensAfter = estimateTokens(compacted);

  return {
    messages: compacted,
    removedCount: messages.length - compacted.length,
    tokensBefore,
    tokensAfter,
    strategy: 'importance-weighted',
  };
}

// ============================================================
// Snip Compaction Strategy
// ============================================================

/**
 * Snip compaction options
 */
export interface SnipOptions {
  /** Keep system messages (default: true) */
  keepSystemMessages?: boolean;
  /** Keep pinned messages (default: true) */
  keepPinnedMessages?: boolean;
}

/**
 * Snip compaction strategy
 *
 * Removes old conversation turns while preserving the most recent ones.
 * A "turn" is defined as a user message + all following assistant/tool messages.
 * System messages and pinned messages are preserved by default.
 *
 * @param messages - Original message array
 * @param keepRecentTurns - Number of most recent turns to preserve
 * @param options - Configuration options
 * @returns Compaction result
 */
export function snipCompaction(
  messages: Message[],
  keepRecentTurns: number,
  options: SnipOptions = {}
): CompactionResult {
  const tokensBefore = estimateTokens(messages);
  const cfg = { keepSystemMessages: true, keepPinnedMessages: true, ...options };

  if (messages.length === 0) {
    return {
      messages: [],
      removedCount: 0,
      tokensBefore,
      tokensAfter: 0,
      strategy: 'snip',
    };
  }

  // Identify turn boundaries: each user message starts a new turn
  // We scan from the end to count turns
  const turnBoundaries: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      turnBoundaries.push(i);
    }
  }
  // turnBoundaries is in reverse order (last user first)
  // If no user messages exist, treat the entire list as one "turn"
  // and keep everything (no-op). This prevents dropping all messages.
  if (turnBoundaries.length === 0) {
    return {
      messages: [...messages],
      removedCount: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
      strategy: 'snip',
    };
  }

  // Indices to preserve
  const keepIndices = new Set<number>();

  // Keep system messages
  if (cfg.keepSystemMessages) {
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]?.role === 'system') {
        keepIndices.add(i);
      }
    }
  }

  // Keep pinned messages
  if (cfg.keepPinnedMessages) {
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]?.metadata?.pinned === true) {
        keepIndices.add(i);
      }
    }
  }

  // Keep last keepRecentTurns turns
  // turnBoundaries is reverse-ordered (index 0 = last user)
  const turnsToKeep = Math.min(keepRecentTurns, turnBoundaries.length);

  if (turnsToKeep > 0) {
    // The first keepRecentTurns entries in turnBoundaries are the most recent turns
    for (let t = 0; t < turnsToKeep; t++) {
      const turnStart = turnBoundaries[t]!;
      // A turn goes from turnStart to either the next turn boundary (which is turnBoundaries[t-1])
      // or to the end of messages (for the last turn)
      const turnEnd = t > 0 ? turnBoundaries[t - 1]! : messages.length;

      for (let i = turnStart; i < turnEnd; i++) {
        keepIndices.add(i);
      }
    }
  }

  // Build compacted messages (maintain order)
  const compacted: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (keepIndices.has(i)) {
      compacted.push(messages[i]!);
    }
  }

  const tokensAfter = estimateTokens(compacted);

  return {
    messages: compacted,
    removedCount: messages.length - compacted.length,
    tokensBefore,
    tokensAfter,
    strategy: 'snip',
  };
}

// ============================================================
// Pointer-Indexed Strategy
// ============================================================

/**
 * Pointer-indexed compaction configuration
 */
export interface PointerIndexedConfig {
  /** Number of most recent messages to always preserve in context */
  preserveRecent: number;
  /** Session ID for indexing (used as namespace in VectorStore) */
  sessionId: string;
  /** Maximum number of messages to index per compaction (0 = unlimited) */
  maxIndexCount?: number;
  /** Monotonic compaction counter within this session (for unique doc IDs) */
  compactionIndex?: number;
}

/**
 * Pointer-indexed compaction strategy
 *
 * Instead of discarding removed messages, this strategy:
 * 1. Generates embeddings for messages being removed
 * 2. Indexes each message as a VectorDocument in the VectorStore
 * 3. Replaces removed messages with a pointer message in context
 * 4. Enables future semantic retrieval via VectorStore.search()
 *
 * The pointer message serves as a lightweight reference that
 * future agent sessions can use to query the indexed history.
 *
 * Falls back to truncate-oldest if VectorStore or EmbeddingModel is unavailable.
 *
 * @param messages - Original message array
 * @param config - Pointer-indexed configuration
 * @param vectorStore - Vector store for indexing (optional, falls back to truncate)
 * @param embeddingModel - Embedding model for generating vectors (optional)
 * @returns Compaction result with pointer message
 */
export async function pointerIndexed(
  messages: Message[],
  config: PointerIndexedConfig,
  vectorStore?: VectorStore,
  embeddingModel?: EmbeddingModel
): Promise<CompactionResult> {
  const tokensBefore = estimateTokens(messages);

  if (messages.length <= config.preserveRecent) {
    return {
      messages: [...messages],
      removedCount: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
      strategy: 'pointer-indexed',
    };
  }

  // Fallback to truncate if no VectorStore or EmbeddingModel
  if (!vectorStore || !embeddingModel) {
    return truncateOldest(messages, config.preserveRecent);
  }

  // Identify messages to archive (all except recent ones)
  const toArchive = messages.slice(0, messages.length - config.preserveRecent);
  const recentMessages = messages.slice(messages.length - config.preserveRecent);

  // Limit index count if configured
  const maxIndex =
    config.maxIndexCount && config.maxIndexCount > 0
      ? Math.min(config.maxIndexCount, toArchive.length)
      : toArchive.length;

  // Prepare texts for batch embedding
  const indexedMessages: { msg: Message; index: number }[] = [];
  const texts: string[] = [];
  for (let i = 0; i < maxIndex; i++) {
    const msg = toArchive[i];
    if (!msg) continue;
    const text = extractText(msg.content);
    if (!text) continue;
    indexedMessages.push({ msg, index: i });
    texts.push(text);
  }

  // Batch generate all embeddings at once
  let embeddings: number[][] = [];
  try {
    embeddings = await embeddingModel.embedBatch(texts);
  } catch {
    // All embeddings failed — fall back to truncate-oldest to avoid data loss
    return truncateOldest(messages, config.preserveRecent);
  }

  // Index each message into VectorStore with isolation per insert
  const cIdx = config.compactionIndex ?? 0;
  let indexedCount = 0;
  const indexedIds: string[] = [];

  for (let j = 0; j < indexedMessages.length && j < embeddings.length; j++) {
    const { msg, index } = indexedMessages[j]!;
    const embedding = embeddings[j]!;

    const docId = `${config.sessionId}-c${cIdx}-m${index}`;
    const doc: VectorDocument = {
      id: docId,
      embedding,
      content: extractText(msg.content),
      metadata: {
        role: msg.role,
        name: msg.name,
        sessionId: config.sessionId,
        compactionIndex: cIdx,
        messageIndex: index,
        archivedAt: Date.now(),
      },
      createdAt: Date.now(),
    };

    try {
      vectorStore.insert(doc);
      indexedIds.push(docId);
      indexedCount++;
    } catch {
      // Isolate per-insert failures — non-fatal
    }
  }

  // If ALL indexing failed, fall back to truncate to avoid silent data loss
  if (indexedCount === 0) {
    return truncateOldest(messages, config.preserveRecent);
  }

  // Build pointer message summarizing what was indexed
  const pointerContent = [
    `[Semantic Memory Pointer]`,
    `${indexedCount} messages archived to vector store.`,
    `Session: ${config.sessionId}`,
    `Compaction: #${cIdx}`,
    `Pointer IDs: ${indexedIds.slice(0, 5).join(', ')}${indexedIds.length > 5 ? '...' : ''}`,
    `Query via semantic search with session "${config.sessionId}" to retrieve context.`,
  ].join('\n');

  const pointerMsg: Message = {
    role: 'system',
    content: pointerContent,
    name: `memory-pointer-c${cIdx}`,
  };

  const compacted = [pointerMsg, ...recentMessages];
  const tokensAfter = estimateTokens(compacted);

  return {
    messages: compacted,
    removedCount: toArchive.length,
    tokensBefore,
    tokensAfter,
    strategy: 'pointer-indexed',
  };
}

// ============================================================
// Microcompact Strategy
// ============================================================

/**
 * Microcompact configuration.
 */
export interface MicrocompactConfig {
  /** Max chars per tool result (default 2000) */
  maxToolResultChars?: number;
  /** Max chars per assistant message (default: no limit) */
  maxAssistantChars?: number;
  /** Preserve system messages untouched */
  preserveSystem?: boolean;
}

/**
 * Microcompact compaction strategy.
 *
 * Truncates large tool results and assistant messages in-place without
 * removing any messages from the conversation. This is a cheap, no-LLM
 * operation that reduces token usage while preserving conversation structure.
 *
 * Designed to be the second stage in a multi-layer compaction pipeline:
 *   snip (remove old turns) → microcompact (trim long results) → full compact
 *
 * @param messages - Original message array
 * @param config - Microcompact configuration
 * @returns Compaction result with trimmed messages
 */
export function microcompact(
  messages: Message[],
  config: MicrocompactConfig = {}
): CompactionResult {
  const tokensBefore = estimateTokens(messages);
  const maxToolChars = config.maxToolResultChars ?? 2000;
  const maxAsstChars = config.maxAssistantChars ?? 0; // 0 = no limit
  const preserveSystem = config.preserveSystem ?? true;

  let trimmedCount = 0;
  const compacted = messages.map(msg => {
    if (preserveSystem && msg.role === 'system') return msg;

    let maxChars: number | undefined;
    if (msg.role === 'tool') {
      maxChars = maxToolChars;
    } else if (msg.role === 'assistant' && maxAsstChars > 0) {
      maxChars = maxAsstChars;
    } else {
      return msg;
    }

    const content = typeof msg.content === 'string' ? msg.content : extractText(msg.content);
    if (content.length <= maxChars) return msg;

    trimmedCount++;
    const half = Math.floor(maxChars / 2);
    const truncated = content.slice(0, half) + '\n\n[...truncated...]\n\n' + content.slice(-half);

    return { ...msg, content: truncated };
  });

  return {
    messages: compacted,
    removedCount: 0, // No messages removed — in-place trimming
    tokensBefore,
    tokensAfter: estimateTokens(compacted),
    strategy: 'microcompact',
    trimmedCount,
  };
}
