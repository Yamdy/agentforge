/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * Tool Concurrency Partitioning
 *
 * Groups tool calls from an LLM response into execution batches.
 * Each batch either runs in parallel (isConcurrencySafe) or serially.
 *
 * Core algorithm:
 * 1. Group consecutive concurrency-safe tools into one batch
 * 2. Non-concurrency-safe tools get their own batch (serial)
 * 3. Respects dependency ordering (tools are executed in LLM output order)
 *
 * Ported from ClaudeCode: src/services/tools/toolOrchestration.ts
 *
 * @see docs/design/23-TOOL-CONCURRENCY.md
 */

import type { ToolCall } from '../core/events.js';

// ============================================================
// Types
// ============================================================

/** A batch of tool calls to execute together */
export interface ToolBatch {
  /** Whether this batch can run in parallel */
  isConcurrencySafe: boolean;
  /** Tool calls in this batch */
  calls: ToolCall[];
}

// ============================================================
// Partitioning
// ============================================================

/**
 * Partition tool calls into execution batches.
 *
 * Algorithm:
 * - Walk through calls in order
 * - Consecutive concurrency-safe calls → one batch (parallel)
 * - Non-concurrency-safe calls → individual batches (serial)
 * - Mixed: non-concurrency-safe resets the batch boundary
 *
 * @param toolCalls - Tool calls from LLM response
 * @param registry  - Tool registry (to check isConcurrencySafe)
 * @returns Batches in execution order
 */
export function partitionToolCalls(
  toolCalls: ToolCall[],
  registry: { isConcurrencySafe?: (name: string) => boolean } | null
): ToolBatch[] {
  if (!toolCalls.length) return [];

  const batches: ToolBatch[] = [];
  let currentBatch: ToolCall[] = [];
  let currentIsParallel = true;

  for (const tc of toolCalls) {
    // Check if this tool is concurrency-safe
    const isSafe = typeof registry?.isConcurrencySafe === 'function'
      ? registry.isConcurrencySafe(tc.name)
      : true; // Default: safe

    if (currentBatch.length === 0) {
      // First call — start new batch
      currentBatch.push(tc);
      currentIsParallel = isSafe;
    } else if (currentIsParallel === isSafe) {
      // Same safety level — add to current batch
      currentBatch.push(tc);
    } else {
      // Safety level changed — flush current batch, start new
      batches.push({
        isConcurrencySafe: currentIsParallel,
        calls: currentBatch,
      });
      currentBatch = [tc];
      currentIsParallel = isSafe;
    }
  }

  // Flush final batch
  if (currentBatch.length > 0) {
    batches.push({
      isConcurrencySafe: currentIsParallel,
      calls: currentBatch,
    });
  }

  return batches;
}
