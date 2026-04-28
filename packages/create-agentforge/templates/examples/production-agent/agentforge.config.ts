/**
 * Production Agent - Full MPU stack with observability and resilience
 *
 * A production-ready agent with all MPU modules enabled:
 * - M1: SQLite checkpoint persistence
 * - M4: Circuit breaker (resilience)
 * - M5: Audit logging
 * - M6: Tool security
 * - M7: Cost control (quota)
 * - M8: Observability (logger, tracer, metrics)
 * - M9: Graceful shutdown
 * - M10: Result validation
 *
 * Run with: npx tsx src/index.ts
 */

import { defineConfig } from 'agentforge';
import { z } from 'zod';
import { adapter } from './src/llm/adapter.js';
import { checkpointStorage } from './src/checkpoint/storage.js';
import { logger, tracer, metrics } from './src/observability/index.js';
import { securityPolicy } from './src/security/policy.js';
import { resilienceConfig } from './src/resilience/config.js';

export default defineConfig({
  name: 'production-agent',

  // LLM provider and model
  model: 'openai/gpt-4o',

  // Higher step limit for production workflows
  maxSteps: 30,

  // LLM adapter
  llm: adapter,

  // Production tools with security policy
  tools: {
    // Secure file read (validated by security policy)
    readFile: {
      description: 'Read a file from the filesystem (subject to security policy)',
      parameters: z.object({
        path: z.string().describe('Path to the file to read'),
      }),
      execute: async (args: { path: string }) => {
        // Security check
        if (!securityPolicy.isPathAllowed(args.path)) {
          return `Access denied: path "${args.path}" is not allowed by security policy.`;
        }
        const { readFile } = await import('node:fs/promises');
        try {
          return await readFile(args.path, 'utf-8');
        } catch (error: unknown) {
          return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  },

  // M1: Checkpoint persistence (SQLite)
  checkpoint: true,

  // M8: Observability
  tracing: true,
  metrics: true,

  // Production preset
  preset: 'production' as const,
});