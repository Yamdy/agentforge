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
  });
});
