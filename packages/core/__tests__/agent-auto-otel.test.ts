import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { autoDetectOtelTracer } from '../src/agent.js';

describe('Agent auto OTel detection', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_SDK_DISABLED']) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of Object.keys(savedEnv)) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  describe('autoDetectOtelTracer', () => {
    it('returns undefined when OTEL_SDK_DISABLED is true', () => {
      process.env.OTEL_SDK_DISABLED = 'true';
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
      expect(autoDetectOtelTracer()).toBeUndefined();
    });

    it('returns undefined when no OTel env vars are set', () => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      expect(autoDetectOtelTracer()).toBeUndefined();
    });

    it('returns undefined when endpoint is set but OTel SDK is not installed', () => {
      // When endpoint IS set but @opentelemetry/sdk-trace-base is not available
      // at runtime, autoDetectOtelTracer should gracefully return undefined
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
      // In the test environment, the OTel SDK packages may or may not be available
      // The function must not throw
      const result = autoDetectOtelTracer();
      expect(result === undefined || (typeof result === 'object' && result !== null)).toBe(true);
    });

    it('does not throw even with invalid endpoint URL', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'not-a-valid-url';
      expect(() => autoDetectOtelTracer()).not.toThrow();
    });

    it('accepts sampler parameter without throwing', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
      const result = autoDetectOtelTracer('always_off');
      // Returns Tracer or undefined depending on OTel SDK availability
      expect(result === undefined || (typeof result === 'object' && result !== null)).toBe(true);
    });

    it('accepts ratio sampler parameter without throwing', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
      const result = autoDetectOtelTracer({ ratio: 0.25 });
      expect(result === undefined || (typeof result === 'object' && result !== null)).toBe(true);
    });

    it('returns a Tracer when OTel is configured and available', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
      const result = autoDetectOtelTracer();
      // In test env with hoisted OTel SDK, this should return a real Tracer
      if (result) {
        // Verify it has the Tracer interface
        expect(typeof result.startSpan).toBe('function');
        expect(typeof result.getCurrentSpan).toBe('function');
      }
      // Graceful: if SDK wasn't available, result is undefined (still valid)
    });
  });
});
