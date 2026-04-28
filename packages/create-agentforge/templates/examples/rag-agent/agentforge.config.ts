/**
 * RAG Agent - Retrieval-augmented generation with vector store
 *
 * Demonstrates how to build a RAG pipeline that:
 * 1. Embeds documents into a vector store
 * 2. Retrieves relevant context for user queries
 * 3. Augments LLM prompts with retrieved context
 *
 * Run with: npx tsx src/index.ts
 */

import { defineConfig } from 'agentforge';
import { z } from 'zod';
import { adapter } from './src/llm/adapter.js';
import { vectorStore } from './src/rag/store.js';

export default defineConfig({
  name: 'rag-agent',

  // LLM provider and model
  model: 'openai/gpt-4o',

  // Maximum steps (RAG queries may need multiple tool calls)
  maxSteps: 20,

  // LLM adapter
  llm: adapter,

  // RAG tools — the agent uses these to search documents
  tools: {
    // Search the vector store for relevant documents
    searchDocuments: {
      description: 'Search the knowledge base for relevant documents. Use this to find information before answering questions.',
      parameters: z.object({
        query: z.string().describe('The search query to find relevant documents'),
        topK: z.number().optional().describe('Number of results to return (default: 3)'),
      }),
      execute: async (args: { query: string; topK?: number }) => {
        const results = await vectorStore.search(args.query, args.topK ?? 3);
        if (results.length === 0) {
          return 'No relevant documents found. Try a different query.';
        }
        return results
          .map((r: { content: string; score: number; metadata: Record<string, unknown> }, i: number) =>
            `[${i + 1}] (score: ${r.score.toFixed(3)}) ${r.content}\n  Source: ${JSON.stringify(r.metadata)}`
          )
          .join('\n\n');
      },
    },

    // List available documents in the store
    listDocuments: {
      description: 'List all available documents in the knowledge base',
      parameters: z.object({}),
      execute: async () => {
        const docs = vectorStore.list();
        if (docs.length === 0) {
          return 'No documents in the knowledge base. Add documents using the index script.';
        }
        return docs.map((d: { id: string; metadata: Record<string, unknown> }) =>
          `- ${d.id}: ${JSON.stringify(d.metadata)}`
        ).join('\n');
      },
    },
  },

  // System prompt instructs the agent to use RAG
  systemPrompt: `You are a knowledgeable assistant with access to a document knowledge base.
When answering questions, ALWAYS search the knowledge base first using the searchDocuments tool.
Base your answers on the retrieved documents and cite your sources.
If the knowledge base doesn't contain relevant information, say so clearly.`,
});