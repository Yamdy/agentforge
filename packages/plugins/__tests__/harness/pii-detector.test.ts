import { describe, it, expect } from 'vitest';
import { createPiiDetectorProcessor } from '../../src/harness/pii-detector-processor.js';
import type { PipelineContext, ProcessorContext } from '@primo-ai/sdk';
import { ProcessorContextImpl, AbortControlFlow } from '@primo-ai/core';

function makeContext(input = 'Hello, how are you?', response?: string): PipelineContext {
  return {
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0, response },
    session: { input, sessionId: 's1', custom: {} },
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

describe('PiiDetectorProcessor', () => {
  describe('processInput stage (checking user input)', () => {
    it('allows input with no PII', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email', 'phone', 'ssn', 'creditCard', 'ip', 'name'],
      });
      const pCtx = makeProcessorContext('What is the weather today?');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).toBe('What is the weather today?');
    });

    it('redacts email addresses', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const pCtx = makeProcessorContext('My email is john@example.com');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).not.toContain('john@example.com');
      expect(pCtx.state.session.input).toContain('[REDACTED]');
    });

    it('redacts phone numbers', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['phone'],
      });
      const pCtx = makeProcessorContext('Call me at 555-123-4567');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).not.toContain('555-123-4567');
      expect(pCtx.state.session.input).toContain('[REDACTED]');
    });

    it('redacts SSN', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['ssn'],
      });
      const pCtx = makeProcessorContext('My SSN is 123-45-6789');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).not.toContain('123-45-6789');
      expect(pCtx.state.session.input).toContain('[REDACTED]');
    });

    it('redacts credit card numbers', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['creditCard'],
      });
      const pCtx = makeProcessorContext('Card: 4111-1111-1111-1111');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).not.toContain('4111-1111-1111-1111');
      expect(pCtx.state.session.input).toContain('[REDACTED]');
    });

    it('redacts IP addresses', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['ip'],
      });
      const pCtx = makeProcessorContext('Server is at 192.168.1.100');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).not.toContain('192.168.1.100');
      expect(pCtx.state.session.input).toContain('[REDACTED]');
    });

    it('blocks input with PII when strategy is block', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'block',
        piiTypes: ['email'],
      });
      const pCtx = makeProcessorContext('My email is test@example.com');
      const reason = await expectAbort(pCtx, processor);
      expect(reason).toContain('PII');
    });

    it('warns but continues with PII when strategy is warn', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'warn',
        piiTypes: ['email'],
      });
      const pCtx = makeProcessorContext('My email is test@example.com');
      await processor.execute(pCtx);
      // Original text preserved on warn
      expect(pCtx.state.session.input).toContain('test@example.com');
    });

    it('passes through when disabled', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: false,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const pCtx = makeProcessorContext('My email is test@example.com');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).toContain('test@example.com');
    });

    it('only checks configured PII types', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'block',
        piiTypes: ['email'], // only email, not phone
      });
      // Phone number should not be detected
      const pCtx = makeProcessorContext('Call me at 555-123-4567');
      await processor.execute(pCtx);
      // No abort = allowed
    });

    it('uses custom redaction text', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
        redactionText: '[HIDDEN]',
      });
      const pCtx = makeProcessorContext('My email is john@example.com');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).toContain('[HIDDEN]');
      expect(pCtx.state.session.input).not.toContain('john@example.com');
    });

    it('supports custom patterns', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['employeeId'],
        customPatterns: {
          employeeId: /\bEMP-\d{5}\b/g,
        },
      });
      const pCtx = makeProcessorContext('My ID is EMP-12345');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).not.toContain('EMP-12345');
      expect(pCtx.state.session.input).toContain('[REDACTED]');
    });

    it('redacts multiple PII occurrences in one input', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email', 'phone'],
      });
      const pCtx = makeProcessorContext('Email: a@b.com and phone: 555-000-1111');
      await processor.execute(pCtx);
      expect(pCtx.state.session.input).not.toContain('a@b.com');
      expect(pCtx.state.session.input).not.toContain('555-000-1111');
    });
  });

  describe('processOutput stage (checking LLM output)', () => {
    it('redacts PII in LLM response', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const pCtx = makeProcessorContext('Hello', 'Send it to user@example.com');
      await processor.execute(pCtx);
      expect(pCtx.state.iteration.response).not.toContain('user@example.com');
      expect(pCtx.state.iteration.response).toContain('[REDACTED]');
    });

    it('blocks output containing PII', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'block',
        piiTypes: ['ssn'],
      });
      const pCtx = makeProcessorContext('Hello', 'The SSN is 999-88-7777');
      const reason = await expectAbort(pCtx, processor);
      expect(reason).toContain('PII');
    });

    it('warns on PII in output but passes through', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'warn',
        piiTypes: ['email'],
      });
      const pCtx = makeProcessorContext('Hello', 'Email me at test@example.com');
      await processor.execute(pCtx);
      expect(pCtx.state.iteration.response).toContain('test@example.com');
    });

    it('handles missing response gracefully', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const pCtx = makeProcessorContext('Hello');
      await processor.execute(pCtx);
      // No abort = allowed
    });
  });

  describe('span instrumentation', () => {
    it('records PII detection results in session custom data', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const pCtx = makeProcessorContext('Email: test@example.com');
      await processor.execute(pCtx);
      const piiState = pCtx.state.session.custom.piiDetector as { lastDecision: string; matches: unknown[] };
      expect(piiState).toBeDefined();
      expect(piiState.lastDecision).toBe('redacted');
      expect(piiState.matches.length).toBeGreaterThan(0);
    });

    it('records allowed decision when no PII found', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const pCtx = makeProcessorContext('No PII here');
      await processor.execute(pCtx);
      const piiState = pCtx.state.session.custom.piiDetector as { lastDecision: string; matches: unknown[] };
      expect(piiState.lastDecision).toBe('allowed');
    });
  });
});
