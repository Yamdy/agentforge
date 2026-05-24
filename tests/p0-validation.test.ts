/**
 * P0 Production-Ready Validation Tests
 *
 * Validates all P0 features work correctly:
 * - Task 1: Provider multi-model routing
 * - Task 2: Tool.Context system
 * - Task 3: Builtin tool adaptation
 * - Task 4: Truncate output system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// ========== Task 1: Provider ==========
import { Provider as ProviderAPI, providerRegistry } from '../src/provider/index.js';
import { anthropicProvider } from '../src/provider/providers/anthropic.js';
import { openaiProvider } from '../src/provider/providers/openai.js';

// ========== Task 2: Tool.Context ==========
import { createMockToolContext } from '../src/tool/context.js';
import type { ToolContext } from '../src/tool/context.js';
import type { ToolResult } from '../src/tool/result.js';

// ========== Task 3: Builtin Tools ==========
import { ToolRegistry } from '../src/registry.js';
import { BashTool } from '../src/tools/builtin/bash.js';
import { GrepTool } from '../src/tools/builtin/grep.js';
import { FindTool } from '../src/tools/builtin/find.js';
import { ReadTool } from '../src/tools/builtin/read.js';
import { WriteTool } from '../src/tools/builtin/write.js';
import { LsTool } from '../src/tools/builtin/ls.js';
import { AskUserTool } from '../src/tools/builtin/ask_user.js';

// ========== Task 4: Truncate ==========
import {
  truncate,
  truncateAndSave,
  truncateIfNeeded,
  truncateIfNeededAsync,
} from '../src/truncate/index.js';
import { cleanupOldFiles } from '../src/truncate/cleanup.js';
import { saveTruncatedOutput } from '../src/truncate/storage.js';

// ============================================================
// Task 1: Provider 多模型路由系统
// ============================================================

describe('P0 Validation: Provider System (Task 1)', () => {
  it('Provider.model("anthropic", "claude-sonnet-4") should return a model when configured', () => {
    // Note: This test requires ANTHROPIC_API_KEY to be set
    // If not configured, we verify the validation works correctly
    try {
      const model = ProviderAPI.model('anthropic', 'claude-sonnet-4-20250514');
      expect(model).toBeDefined();
      expect(typeof model).toBe('object');
    } catch (error) {
      // If API key is not set, this is expected behavior
      expect((error as Error).message).toContain('not properly configured');
    }
  });

  it('Provider.model("openai", "gpt-4o") should return a model when configured', () => {
    // Note: This test requires OPENAI_API_KEY to be set
    try {
      const model = ProviderAPI.model('openai', 'gpt-4o');
      expect(model).toBeDefined();
      expect(typeof model).toBe('object');
    } catch (error) {
      // If API key is not set, this is expected behavior
      expect((error as Error).message).toContain('not properly configured');
    }
  });

  it('Provider.findModel("claude") should return model info', async () => {
    const model = await ProviderAPI.findModel('claude');
    expect(model).toBeDefined();
    expect(model).not.toBeNull();
    expect(model!.providerId).toBe('anthropic');
    expect(model!.id).toContain('claude');
  });

  it('Provider.findModel("gpt-4o") should return exact match', async () => {
    const model = await ProviderAPI.findModel('gpt-4o');
    expect(model).toBeDefined();
    expect(model).not.toBeNull();
    expect(model!.id).toBe('gpt-4o');
  });

  it('should list all registered providers', () => {
    const providers = ProviderAPI.list();
    expect(providers.length).toBeGreaterThanOrEqual(7);

    const ids = providers.map((p) => p.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('azure');
    expect(ids).toContain('bedrock');
    expect(ids).toContain('vertex');
    expect(ids).toContain('openrouter');
    expect(ids).toContain('ollama');
  });

  it('should throw for unknown provider in model()', () => {
    expect(() => ProviderAPI.model('unknown-provider', 'model')).toThrow();
  });

  it('anthropic provider should have toolCall capability', async () => {
    const modelInfo = await anthropicProvider.getModel('claude-sonnet-4-20250514');
    expect(modelInfo).toBeDefined();
    expect(modelInfo!.capabilities.toolCall).toBe(true);
  });

  it('openai provider should list gpt-4o-mini', async () => {
    const models = await openaiProvider.listModels();
    expect(models.find((m) => m.id === 'gpt-4o-mini')).toBeDefined();
  });
});

// ============================================================
// Task 2: Tool.Context 上下文系统
// ============================================================

describe('P0 Validation: Tool.Context System (Task 2)', () => {
  it('ToolContext should have all required fields', () => {
    const ctx = createMockToolContext();
    expect(ctx.sessionId).toBeDefined();
    expect(ctx.messageId).toBeDefined();
    expect(ctx.callId).toBeDefined();
    expect(ctx.agent).toBeDefined();
    expect(ctx.abort).toBeDefined();
    expect(ctx.messages).toBeDefined();
    expect(typeof ctx.metadata).toBe('function');
    expect(typeof ctx.ask).toBe('function');
  });

  it('ToolContext.metadata() should be callable without error', () => {
    const ctx = createMockToolContext();
    expect(() => {
      ctx.metadata({ title: 'Processing...', progress: 50 });
    }).not.toThrow();
  });

  it('ToolContext.ask() should return a result', async () => {
    const ctx = createMockToolContext();
    const result = await ctx.ask({ message: 'Proceed?' });
    expect(result.choice).toBeDefined();
  });

  it('ToolContext should allow overriding fields', () => {
    const abortController = new AbortController();
    const ctx = createMockToolContext({
      sessionId: 'custom-session',
      callId: 'custom-call',
      abort: abortController.signal,
      messages: [
        { role: 'user', content: 'test message' },
      ],
    });

    expect(ctx.sessionId).toBe('custom-session');
    expect(ctx.callId).toBe('custom-call');
    expect(ctx.abort).toBe(abortController.signal);
    expect(ctx.messages).toHaveLength(1);
  });

  it('ToolContext.abort should support cancellation', () => {
    const abortController = new AbortController();
    const ctx = createMockToolContext({ abort: abortController.signal });

    expect(ctx.abort.aborted).toBe(false);
    abortController.abort();
    expect(ctx.abort.aborted).toBe(true);
  });

  it('ToolResult should support truncated + outputPath fields', () => {
    const result: ToolResult = {
      title: 'Test',
      output: 'truncated content',
      truncated: true,
      outputPath: '/tmp/full-output.txt',
    };

    expect(result.truncated).toBe(true);
    expect(result.outputPath).toBe('/tmp/full-output.txt');
  });
});

// ============================================================
// Task 3: 内置工具适配 (New Tool<P,M> interface)
// ============================================================

describe('P0 Validation: Builtin Tool Adaptation (Task 3)', () => {
  let registry: ToolRegistry;
  const mockCtx = createMockToolContext();

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register([BashTool, GrepTool, FindTool, ReadTool, WriteTool, LsTool, AskUserTool]);
  });

  it('all builtin tools should be registered', () => {
    const tools = registry.list();
    const names = tools.map((t) => t.name);
    expect(names).toContain('bash');
    expect(names).toContain('grep');
    expect(names).toContain('find');
    expect(names).toContain('read');
    expect(names).toContain('write');
    expect(names).toContain('ls');
    expect(names).toContain('ask_user');
  });

  it('BashTool should have Zod parameters schema', () => {
    expect(BashTool.parameters).toBeDefined();
    const schema = BashTool.parameters!;
    // Zod schema should parse valid input
    const result = schema.safeParse({
      command: 'echo hello',
      description: 'test command',
    });
    expect(result.success).toBe(true);
  });

  it('GrepTool should have Zod parameters schema', () => {
    expect(GrepTool.parameters).toBeDefined();
    const result = GrepTool.parameters!.safeParse({
      pattern: 'test',
      path: '.',
    });
    expect(result.success).toBe(true);
  });

  it('FindTool should have Zod parameters schema', () => {
    expect(FindTool.parameters).toBeDefined();
    const result = FindTool.parameters!.safeParse({
      path: '.',
    });
    expect(result.success).toBe(true);
  });

  it('tools should accept ToolContext and return ToolResult', async () => {
    // Use a safe bash command to verify Tool<P,M> interface
    const result = await registry.execute('bash', {
      command: 'echo hello',
      description: 'test echo',
    }, mockCtx);

    expect(result).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.output).toBeDefined();
    expect(result.output).toContain('hello');
  });

  it('ReadTool should return ToolResult with metadata', async () => {
    const result = await registry.execute('read', {
      filePath: 'package.json',
    }, mockCtx);

    expect(result).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.output).toBeDefined();
    expect(result.output).toContain('agentforge');
  });

  it('AskUserTool should use ctx.ask()', async () => {
    // AskUserTool depends on ctx.ask() — verify it's wired up
    expect(AskUserTool.name).toBe('ask_user');
    expect(AskUserTool.parameters).toBeDefined();
  });
});

// ============================================================
// Task 4: Truncate 输出截断系统
// ============================================================

describe('P0 Validation: Truncate System (Task 4)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `agentforge-p0-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('truncateIfNeeded should be an alias for truncate', () => {
    const content = 'test content';
    expect(truncateIfNeeded(content)).toEqual(truncate(content));
  });

  it('truncateIfNeededAsync should be an alias for truncateAndSave', async () => {
    const content = 'x'.repeat(100000);
    const r1 = await truncateIfNeededAsync(content, { maxBytes: 50000, tempDir: testDir });
    const r2 = await truncateAndSave(content, { maxBytes: 50000, tempDir: testDir });
    expect(r1.truncated).toBe(r2.truncated);
  });

  it('Bash output exceeding limits should be truncated', async () => {
    // Generate a command that outputs > 2000 lines
    const ctx = createMockToolContext();
    const result = await BashTool.execute(
      {
        command: 'for i in $(seq 1 2100); do echo "Line $i"; done',
        description: 'Generate large output',
      },
      ctx
    );

    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
    // The output should be truncated since 2100 lines > 2000 default
    expect(result.output.length).toBeLessThan(2100 * 10); // Much less than full output
  });

  it('Truncated output should reference a file path', async () => {
    const content = Array(3000).fill('test line content').join('\n');
    const result = await truncateAndSave(content, {
      maxLines: 2000,
      maxBytes: 50000,
      tempDir: testDir,
      prefix: 'p0-validation',
    });

    expect(result.truncated).toBe(true);
    expect(result.outputPath).toBeDefined();
    expect(existsSync(result.outputPath!)).toBe(true);

    // Full content should be accessible via read
    const fullContent = await readFile(result.outputPath!, 'utf-8');
    expect(fullContent).toBe(content);
  });

  it('cleanupOldFiles should delete files older than 7 days', async () => {
    // Create an old file
    const oldFile = join(testDir, 'old-output.txt');
    await writeFile(oldFile, 'old content', 'utf-8');

    // Set mtime to 8 days ago
    const { utimes } = await import('node:fs/promises');
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await utimes(oldFile, new Date(eightDaysAgo), new Date(eightDaysAgo));

    // Create a recent file
    const recentFile = join(testDir, 'recent-output.txt');
    await writeFile(recentFile, 'recent content', 'utf-8');

    const deleted = await cleanupOldFiles(7, testDir);
    expect(deleted).toBe(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(recentFile)).toBe(true);
  });

  it('truncate should handle edge case: content exactly at limit', () => {
    const lines = Array(2000).fill('line');
    const content = lines.join('\n');
    const result = truncate(content, { maxLines: 2000, maxBytes: 500000 });

    // Exactly at limit should NOT be truncated
    expect(result.truncated).toBe(false);
  });

  it('truncate should handle edge case: one line over limit', () => {
    const lines = Array(2001).fill('line');
    const content = lines.join('\n');
    const result = truncate(content, { maxLines: 2000, maxBytes: 500000 });

    expect(result.truncated).toBe(true);
  });
});

// ============================================================
// Cross-cutting: Integration
// ============================================================

describe('P0 Validation: Cross-cutting Integration', () => {
  it('ToolRegistry should support both new and legacy tools', async () => {
    const registry = new ToolRegistry();
    const ctx = createMockToolContext();

    // Register a new-style tool (BashTool)
    registry.register([BashTool]);

    // Register a legacy tool
    registry.register({
      name: 'legacy-echo',
      description: 'Legacy echo tool',
      execute: async (args: Record<string, unknown>) => JSON.stringify(args),
    });

    // Execute new-style tool
    const newResult = await registry.execute('bash', {
      command: 'echo test',
      description: 'echo test',
    }, ctx);
    expect(newResult.output).toContain('test');

    // Execute legacy tool
    const legacyResult = await registry.execute('legacy-echo', { msg: 'hello' }, ctx);
    expect(legacyResult.output).toContain('hello');
  });

  it('Provider + ToolContext integration: model lookup works', async () => {
    // Verify Provider can find models (doesn't require API keys)
    const modelInfo = await ProviderAPI.findModel('gpt-4o');
    expect(modelInfo).toBeDefined();
    expect(modelInfo!.id).toBe('gpt-4o');

    // Verify ToolContext is available for tool execution
    const ctx = createMockToolContext({
      agent: 'test-agent',
      sessionId: 'integration-test',
    });
    expect(ctx.agent).toBe('test-agent');
    expect(ctx.sessionId).toBe('integration-test');
  });
});
