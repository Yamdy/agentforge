/**
 * AgentForge Custom Plugin — Shows how to write a processor plugin
 *
 * Demonstrates the four plugin capabilities:
 *   1. Register processors on pipeline stages
 *   2. Register hooks for interception points
 *   3. Subscribe to events
 *   4. Register managed resources
 *
 * Prerequisites:
 *   - .env file with DEEPSEEK_API_KEY
 *
 * Run: npx tsx --env-file=.env custom-plugin.ts
 */

import {
  Agent,
  registerProvider,
  EventBus,
} from '@primo-ai/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { HarnessAPI, PluginRegistration, PipelineContext } from '@primo-ai/sdk';
import { z } from 'zod';

// ─── Provider setup ─────────────────────────────────────────────────────────

registerProvider('deepseek', (modelId: string) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set.');
  const sdk = createOpenAICompatible({ baseURL: 'https://api.deepseek.com', apiKey } as any);
  return sdk.languageModel(modelId);
});

// ─── Custom plugin definition ───────────────────────────────────────────────
//
// A plugin is a factory function that receives the HarnessAPI and returns
// a PluginRegistration. Through the HarnessAPI you can:
//   - registerProcessor(stage, processor) -- add a processor to a pipeline stage
//   - registerHook(hook) -- intercept before/after points
//   - subscribe(eventType, handler) -- listen to events
//   - registerResource(declaration) -- manage lifecycle resources

function loggingPlugin(api: HarnessAPI): PluginRegistration {
  // 1. Register a processor on the buildContext stage
  //    Processors receive and return PipelineContext (or AbortSignal/SuspensionSignal)
  api.registerProcessor('buildContext', {
    stage: 'buildContext',
    execute: async (ctx: PipelineContext) => {
      console.log(`[plugin] buildContext — input: "${ctx.request.input.slice(0, 50)}..."`);
      // You can modify context here, e.g. add prompt fragments
      return {
        ...ctx,
        agent: {
          ...ctx.agent,
          promptFragments: [
            ...ctx.agent.promptFragments,
            '[logging-plugin] Context built at ' + new Date().toISOString(),
          ],
        },
      };
    },
  });

  // 2. Register a processor on processOutput to log the final response
  api.registerProcessor('processOutput', {
    stage: 'processOutput',
    execute: async (ctx: PipelineContext) => {
      const len = ctx.iteration.response?.length ?? 0;
      const tokens = ctx.iteration.tokenUsage;
      console.log(`[plugin] processOutput — ${len} chars, tokens:`, tokens);
      return ctx;
    },
  });

  // 3. Register a hook that fires before each LLM call
  api.registerHook({
    point: 'llm.before',
    handler: (input) => {
      console.log(`[hook:llm.before] model=${input.model}`);
    },
  });

  // 4. Subscribe to agent lifecycle events
  api.subscribe('agent:start', (data: any) => {
    console.log(`[event:agent:start] session=${data?.sessionId?.slice(0, 8)}...`);
  });

  // 5. Register a managed resource (started/stopped with the plugin lifecycle)
  api.registerResource({
    id: 'log-buffer',
    type: 'service',
    config: { maxSize: 100 },
    start: async () => {
      console.log('[resource:log-buffer] Started');
      return { status: 'running' };
    },
    stop: async () => {
      console.log('[resource:log-buffer] Stopped');
    },
  });

  return {}; // Optional: return { processors, tools, commands }
}

// ─── Create agent with custom plugin ────────────────────────────────────────

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant. Be concise.',
  maxIterations: 3,
});

// Register the plugin
agent.use(loggingPlugin);

// ─── Run ────────────────────────────────────────────────────────────────────

async function main() {
  await agent.pluginManager.initializeAll();
  console.log('--- Plugins initialized ---\n');

  const result = await agent.run('Explain what a processor pipeline is in one sentence.');
  console.log('\n--- Result ---');
  console.log('Response:', result.response);
  console.log('Tokens:', result.tokenUsage);

  await agent.pluginManager.shutdown();
}

main().catch(console.error);
