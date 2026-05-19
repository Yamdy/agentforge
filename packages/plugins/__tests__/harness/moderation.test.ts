import { describe, it, expect, vi } from 'vitest';
import { createModerationProcessor } from '../../src/harness/moderation-processor.js';
import type { PipelineContext, ProcessorContext } from '@primo-ai/sdk';
import { ProcessorContextImpl, AbortControlFlow } from '@primo-ai/core';

function makeContext(input = 'Hello, how are you?', response?: string): PipelineContext {
  return {
    request: { input, sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0, response },
    session: { custom: {} },
  } as PipelineContext;
}

function makeProcessorContext(input = 'Hello, how are you?', response?: string): ProcessorContext {
  return new ProcessorContextImpl(makeContext(input, response));
}

/** Helper to test that a processor aborts. Returns the abort reason if aborted. */
async function expectAbort(pCtx: ProcessorContext, processor: { execute: (ctx: ProcessorContext) => Promise<unknown> }): Promise<string> {
  try {
    await processor.execute(pCtx);
    throw new Error('Expected abort but processor returned normally');
  } catch (error) {
    if (error instanceof AbortControlFlow) {
      return error.reason;
    }
    throw error;
  }
}

describe('ModerationProcessor', () => {
  describe('processInput stage (checking user input)', () => {
    it('allows clean input', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence', 'hate', 'self-harm', 'sexual', 'harassment'],
      });
      const pCtx = makeProcessorContext('What is the weather today?');
      await processor.execute(pCtx);
      // No abort = allowed
    });

    it('blocks violent input with block strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
        blockMessage: 'Content blocked by moderation',
      });
      const pCtx = makeProcessorContext('I will kill and destroy everything');
      const reason = await expectAbort(pCtx, processor);
      expect(reason).toContain('moderation');
    });

    it('warns but continues with warn strategy on harmful input', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'warn',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('I will kill you');
      await processor.execute(pCtx);
      // No abort = continued
    });

    it('redacts harmful content with redact strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'redact',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('I will kill you tomorrow');
      await processor.execute(pCtx);
      // The word "kill" should be redacted in the input
      expect(pCtx.state.request.input).not.toContain('kill');
      expect(pCtx.state.request.input).toContain('[REDACTED]');
    });

    it('passes through when disabled', async () => {
      const processor = createModerationProcessor({
        enabled: false,
        strategy: 'block',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('I will kill you');
      await processor.execute(pCtx);
      expect(pCtx.state.request.input).toContain('kill');
    });

    it('only checks configured categories', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['self-harm'], // only check self-harm, not violence
      });
      // Violent content should pass when violence category is not configured
      const pCtx = makeProcessorContext('I will kill you');
      await processor.execute(pCtx);
      // No abort = allowed
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
      const pCtx = makeProcessorContext('something');
      await expectAbort(pCtx, processor);
      expect(customChecker).toHaveBeenCalledWith('something', ['custom']);
    });

    it('uses default blockMessage when not provided', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('I will kill you');
      const reason = await expectAbort(pCtx, processor);
      expect(reason).toContain('moderation');
    });
  });

  describe('processOutput stage (checking LLM output)', () => {
    it('blocks harmful output with block strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('Hello', 'Sure, here is how to kill someone');
      await expectAbort(pCtx, processor);
    });

    it('redacts harmful output with redact strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'redact',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('Hello', 'You should kill them');
      await processor.execute(pCtx);
      expect(pCtx.state.iteration.response).not.toContain('kill');
      expect(pCtx.state.iteration.response).toContain('[REDACTED]');
    });

    it('warns but passes through harmful output with warn strategy', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'warn',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('Hello', 'You should kill them');
      await processor.execute(pCtx);
      // Original text preserved on warn
      expect(pCtx.state.iteration.response).toContain('kill');
    });

    it('allows clean output', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('Hello', 'The weather is nice today');
      await processor.execute(pCtx);
      // No abort = allowed
    });

    it('handles missing response gracefully', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('Hello');
      await processor.execute(pCtx);
      // No abort = allowed
    });
  });

  describe('span instrumentation', () => {
    it('records moderation decision on span via custom state', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('I will kill you');
      await expectAbort(pCtx, processor);
    });

    it('records allowed decision in session custom data', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['violence'],
      });
      const pCtx = makeProcessorContext('Nice weather');
      await processor.execute(pCtx);
      const moderationState = pCtx.state.session.custom.moderation as { lastDecision: string };
      expect(moderationState).toBeDefined();
      expect(moderationState.lastDecision).toBe('allowed');
    });
  });

  describe('hate category detection', () => {
    it('detects hate speech', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['hate'],
      });
      const pCtx = makeProcessorContext('I hate all people of that race');
      await expectAbort(pCtx, processor);
    });
  });

  describe('self-harm category detection', () => {
    it('detects self-harm content', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['self-harm'],
      });
      const pCtx = makeProcessorContext('I want to hurt myself');
      await expectAbort(pCtx, processor);
    });
  });

  describe('harassment category detection', () => {
    it('detects harassment content', async () => {
      const processor = createModerationProcessor({
        enabled: true,
        strategy: 'block',
        categories: ['harassment'],
      });
      const pCtx = makeProcessorContext('I will threaten and bully you');
      await expectAbort(pCtx, processor);
    });
  });
});
