import { describe, it, expect } from 'vitest';
import { createPiiDetectorProcessor } from '../../src/harness/pii-detector-processor.js';
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

describe('PiiDetectorProcessor', () => {
  describe('processInput stage (checking user input)', () => {
    it('allows input with no PII', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email', 'phone', 'ssn', 'creditCard', 'ip', 'name'],
      });
      const result = await processor.execute(makeContext('What is the weather today?'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).toBe('What is the weather today?');
      }
    });

    it('redacts email addresses', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const result = await processor.execute(makeContext('My email is john@example.com'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).not.toContain('john@example.com');
        expect(result.request.input).toContain('[REDACTED]');
      }
    });

    it('redacts phone numbers', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['phone'],
      });
      const result = await processor.execute(makeContext('Call me at 555-123-4567'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).not.toContain('555-123-4567');
        expect(result.request.input).toContain('[REDACTED]');
      }
    });

    it('redacts SSN', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['ssn'],
      });
      const result = await processor.execute(makeContext('My SSN is 123-45-6789'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).not.toContain('123-45-6789');
        expect(result.request.input).toContain('[REDACTED]');
      }
    });

    it('redacts credit card numbers', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['creditCard'],
      });
      const result = await processor.execute(makeContext('Card: 4111-1111-1111-1111'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).not.toContain('4111-1111-1111-1111');
        expect(result.request.input).toContain('[REDACTED]');
      }
    });

    it('redacts IP addresses', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['ip'],
      });
      const result = await processor.execute(makeContext('Server is at 192.168.1.100'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).not.toContain('192.168.1.100');
        expect(result.request.input).toContain('[REDACTED]');
      }
    });

    it('blocks input with PII when strategy is block', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'block',
        piiTypes: ['email'],
      });
      const result = await processor.execute(makeContext('My email is test@example.com'));
      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('PII');
      }
    });

    it('warns but continues with PII when strategy is warn', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'warn',
        piiTypes: ['email'],
      });
      const result = await processor.execute(makeContext('My email is test@example.com'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        // Original text preserved on warn
        expect(result.request.input).toContain('test@example.com');
      }
    });

    it('passes through when disabled', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: false,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const result = await processor.execute(makeContext('My email is test@example.com'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).toContain('test@example.com');
      }
    });

    it('only checks configured PII types', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'block',
        piiTypes: ['email'], // only email, not phone
      });
      // Phone number should not be detected
      const result = await processor.execute(makeContext('Call me at 555-123-4567'));
      expect(isContext(result)).toBe(true);
    });

    it('uses custom redaction text', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
        redactionText: '[HIDDEN]',
      });
      const result = await processor.execute(makeContext('My email is john@example.com'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).toContain('[HIDDEN]');
        expect(result.request.input).not.toContain('john@example.com');
      }
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
      const result = await processor.execute(makeContext('My ID is EMP-12345'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).not.toContain('EMP-12345');
        expect(result.request.input).toContain('[REDACTED]');
      }
    });

    it('redacts multiple PII occurrences in one input', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email', 'phone'],
      });
      const result = await processor.execute(
        makeContext('Email: a@b.com and phone: 555-000-1111'),
      );
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.request.input).not.toContain('a@b.com');
        expect(result.request.input).not.toContain('555-000-1111');
      }
    });
  });

  describe('processOutput stage (checking LLM output)', () => {
    it('redacts PII in LLM response', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const result = await processor.execute(makeContext('Hello', 'Send it to user@example.com'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.iteration.response).not.toContain('user@example.com');
        expect(result.iteration.response).toContain('[REDACTED]');
      }
    });

    it('blocks output containing PII', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'block',
        piiTypes: ['ssn'],
      });
      const result = await processor.execute(makeContext('Hello', 'The SSN is 999-88-7777'));
      expect(isAbort(result)).toBe(true);
      if (isAbort(result)) {
        expect(result.reason).toContain('PII');
      }
    });

    it('warns on PII in output but passes through', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'warn',
        piiTypes: ['email'],
      });
      const result = await processor.execute(makeContext('Hello', 'Email me at test@example.com'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        expect(result.iteration.response).toContain('test@example.com');
      }
    });

    it('handles missing response gracefully', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const result = await processor.execute(makeContext('Hello'));
      expect(isContext(result)).toBe(true);
    });
  });

  describe('span instrumentation', () => {
    it('records PII detection results in session custom data', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const result = await processor.execute(makeContext('Email: test@example.com'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        const piiState = result.session.custom.piiDetector as { lastDecision: string; matches: unknown[] };
        expect(piiState).toBeDefined();
        expect(piiState.lastDecision).toBe('redacted');
        expect(piiState.matches.length).toBeGreaterThan(0);
      }
    });

    it('records allowed decision when no PII found', async () => {
      const processor = createPiiDetectorProcessor({
        enabled: true,
        strategy: 'redact',
        piiTypes: ['email'],
      });
      const result = await processor.execute(makeContext('No PII here'));
      expect(isContext(result)).toBe(true);
      if (isContext(result)) {
        const piiState = result.session.custom.piiDetector as { lastDecision: string; matches: unknown[] };
        expect(piiState.lastDecision).toBe('allowed');
      }
    });
  });
});
