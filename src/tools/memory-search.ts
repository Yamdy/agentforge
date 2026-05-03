/**
 * MemorySearchTool — Semantic memory search via vector embeddings.
 *
 * Provides agents the ability to search archived memories semantically:
 * - Embed query text using the provided embedding model
 * - Search the vector store for similar documents
 * - Return formatted results as a markdown table
 */

import { z } from 'zod';
import type { VectorStore } from '../memory/vector-store.js';
import type { EmbeddingModel } from '../memory/embedding.js';
import type { ToolDefinition } from '../core/interfaces.js';

// ============================================================
// Zod Schema
// ============================================================

const MemorySearchSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  limit: z.number().min(1).max(50).optional().default(5),
  threshold: z.number().min(0).max(1).optional().default(0.7),
});

// ============================================================
// Helpers
// ============================================================

const MAX_CONTENT_LENGTH = 200;

/**
 * Format vector search results as a markdown table.
 *
 * Columns: # | Score | Content
 * Content is truncated to 200 characters.
 */
function formatResults(results: Array<{ score: number; content: string }>): string {
  if (!results || results.length === 0) {
    return 'No matching memories found.';
  }

  const header = '| # | Score | Content |';
  const separator = '|----|-------|---------|';

  const rows = results.map((r, i) => {
    const score = r.score.toFixed(2);
    const truncated =
      r.content.length > MAX_CONTENT_LENGTH
        ? r.content.substring(0, MAX_CONTENT_LENGTH) + '...'
        : r.content;
    const escaped = truncated.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return `| ${i + 1} | ${score} | ${escaped} |`;
  });

  return [header, separator, ...rows].join('\n');
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create the memory_search tool.
 *
 * @param vectorStore - Vector store instance for similarity search
 * @param embeddingModel - Embedding model for generating query embeddings
 * @returns Array of ToolDefinition(s) for memory_search
 */
export function createMemorySearchTool(
  vectorStore: VectorStore,
  embeddingModel: EmbeddingModel
): ToolDefinition[] {
  return [
    {
      name: 'memory_search',
      description:
        'Search archived memories semantically using vector embeddings. ' +
        'Returns the most similar memories ranked by relevance score.',
      parameters: MemorySearchSchema,
      execute: async (args: unknown): Promise<string> => {
        // Tier 1: Validate arguments
        const parsed = MemorySearchSchema.safeParse(args);
        if (!parsed.success) {
          return `Error: Invalid arguments. ${parsed.error.message}`;
        }

        const { query, limit, threshold } = parsed.data;

        // Generate embedding (wrapped in try/catch)
        let embedding: number[];
        try {
          embedding = await embeddingModel.embed(query);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error: Failed to generate embedding: ${message}`;
        }

        // Search vector store (wrapped in try/catch)
        let searchResults: ReturnType<VectorStore['search']> | undefined;
        try {
          searchResults = vectorStore.search(embedding, limit, threshold);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error: Failed to search vector store: ${message}`;
        }

        return formatResults(
          searchResults.map(r => ({
            score: r.score,
            content: r.document.content,
          }))
        );
      },
    },
  ];
}
