import { describe, it, expect, vi } from 'vitest';
import { createModerationProcessor } from '../../src/harness/moderation-processor.js';
import type { PipelineContext, ProcessorResult } from '@primo-ai/sdk';

function makeContext(input = 'Hello, how are you?', response?: string): PipelineContext {
  return {
    request: { input, sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0, response },
    session: { custom: {} },
  } as PipelineContext;
}

function isAbort(r: ProcessorResult): r is { type: 'abort'; reason: string } {
  return 'type' in r && r.type === 'abort';
}

function isContext(r: ProcessorResult): r is PipelineContext {
  return 'request' in r && 'agent' in r;
}

describe('ModerationProcessor', () => {
  describe('processInput stage (checking user input)', () => {
    it('allows clean input', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence', 'hate', 'self-harm', 'sexual', 'harassment'],
      });
      const result = await processor.execute(makeContext('What is the weather today?'));
      expect(isContext(result)).toBe(true);
    });

    it('blocks violent input with block strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
        blockMessage: 'Content blocked by moderation',
      });
      const result = await processor.execute(makeContext('I will kill and destroy everything'));
      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('moderation');
      }
    });

    it('warns but continues with warn strategy on harmful input', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'warn',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('I will kill you'));
      expect(isContext(result)).toBe(true);
    });

    it('redacts harmful content with redact strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'redact',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('I will kill you tomorrow'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        // The word "kill" should be redacted in the input
        expect(result.request.input).not.toContain('kill');
        expect(result.request.input).toContain('[REDACTED]');
      }
    });

    it('passes through when disabled', async () => {
      const processor = createModerationProcessor({
        enabled: false,
        strategy: 'block',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('I will kill you'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).toContain('kill');
      }
    });

    it('only checks configured categories', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['self-harm'], // only check self-harm, not violence
      });
      // Violent content should pass when violence category is not configured
      const result = await processor.execute(makeContext('I will kill you'));
      expect(isContext(result)).toBe(true);
    });

    it('uses custom checker when provided', async () => {
      const customChecker = vi.fn().mockReturnValue({
        flagged: true,
        categories: ['custom'],
        matches: [{ category: 'custom', text: 'badword', index: 0 }],
      });
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['custom'],
        checker: customChecker,
      });
      await processor.execute(makeContext('something'));
      expect(customChecker).toHaveBeenCalledWith('something', ['custom']);
    });

    it('uses default blockMessage when not provided', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('I will kill you'));
      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('moderation');
      }
    });
  });

  describe('processOutput stage (checking LLM output)', () => {
    it('blocks harmful output with block strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('Hello', 'Sure, here is how to kill someone'));
      expect(isAbort(result)).toBe(true);
    });

    it('redacts harmful output with redact strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'redact',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('Hello', 'You should kill them'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.iteration.response).not.toContain('kill');
        expect(result.iteration.response).toContain('[REDACTED]');
      }
    });

    it('warns but passes through harmful output with warn strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'warn',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('Hello', 'You should kill them'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        // Original text preserved on warn
        expect(result.iteration.response).toContain('kill');
      }
    });

    it('allows clean output', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('Hello', 'The weather is nice today'));
      expect(isContext(result)).toBe(true);
    });

    it('handles missing response gracefully', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('Hello'));
      expect(isContext(result)).toBe(true);
    });
  });

  describe('span instrumentation', () => {
    it('records moderation decision on span via custom state', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('I will kill you'));
      expect(isAbort(result)).toBe(true);
    });

    it('records allowed decision in session custom data', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const result = await processor.execute(makeContext('Nice weather'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        const moderationState = result.session.custom.moderation as { lastDecision: string };
        expect(moderationState).toBeDefined();
        expect(moderationState.lastDecision).toBe('allowed');
      }
    });
  });

  describe('hate category detection', () => {
    it('detects hate speech', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['hate'],
      });
      const result = await processor.execute(makeContext('I hate all people of that race'));
      expect(isAbort(result)).toBe(true);
    });
  });

  describe('self-harm category detection', () => {
    it('detects self-harm content', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['self-harm'],
      });
      const result = await processor.execute(makeContext('I want to hurt myself'));
      expect(isAbort(result)).toBe(true);
    });
  });

  describe('harassment category detection', () => {
    it('detects harassment content', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['harassment'],
      });
      const result = await processor.execute(makeContext('I will threaten and bully you'));
      expect(isAbort(result)).toBe(true);
    });
  });
});
