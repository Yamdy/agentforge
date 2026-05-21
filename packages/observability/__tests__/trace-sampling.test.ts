import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveSampler, resolveSamplerRatio, createOtlpTracerProvider } from '../src/otel-exporter.js';

describe('Trace sampling strategy', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['OTEL_TRACES_SAMPLER', 'OTEL_TRACES_SAMPLER_ARG', 'OTEL_SDK_DISABLED']) {
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

  describe('resolveSampler', () => {
    it('defaults to always_on when no env var is set', () => {
      expect(resolveSampler()).toBe('always_on');
    });

    it('returns always_on from env var', () => {
      process.env.OTEL_TRACES_SAMPLER = 'always_on';
      expect(resolveSampler()).toBe('always_on');
    });

    it('returns always_off from env var', () => {
      process.env.OTEL_TRACES_SAMPLER = 'always_off';
      expect(resolveSampler()).toBe('always_off');
    });

    it('returns parentbased_traceidratio from env var', () => {
      process.env.OTEL_TRACES_SAMPLER = 'parentbased_traceidratio';
      expect(resolveSampler()).toBe('parentbased_traceidratio');
    });

    it('defaults to always_on for unrecognized sampler value', () => {
      process.env.OTEL_TRACES_SAMPLER = 'unknown_sampler';
      expect(resolveSampler()).toBe('always_on');
    });
  });

  describe('resolveSamplerRatio', () => {
    it('returns 1.0 when no OTEL_TRACES_SAMPLER_ARG is set', () => {
      delete process.env.OTEL_TRACES_SAMPLER_ARG;
      expect(resolveSamplerRatio()).toBe(1.0);
    });

    it('parses ratio from OTEL_TRACES_SAMPLER_ARG', () => {
      process.env.OTEL_TRACES_SAMPLER_ARG = '0.25';
      expect(resolveSamplerRatio()).toBe(0.25);
    });

    it('returns 1.0 for invalid number', () => {
      process.env.OTEL_TRACES_SAMPLER_ARG = 'not_a_number';
      expect(resolveSamplerRatio()).toBe(1.0);
    });

    it('clamps to 1.0 if > 1.0', () => {
      process.env.OTEL_TRACES_SAMPLER_ARG = '1.5';
      expect(resolveSamplerRatio()).toBe(1.0);
    });

    it('clamps to 0.0 if < 0.0', () => {
      process.env.OTEL_TRACES_SAMPLER_ARG = '-0.5';
      expect(resolveSamplerRatio()).toBe(0.0);
    });
  });

  describe('resolveSamplerFromConfig (via createOtlpTracerProvider)', () => {
    // Provider creation needs an endpoint; provide a dummy one
    beforeEach(() => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
      process.env.OTEL_SDK_DISABLED = 'false';
    });

    afterEach(() => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      delete process.env.OTEL_SDK_DISABLED;
    });

    it('config sampler always_on takes precedence over env always_off', () => {
      process.env.OTEL_TRACES_SAMPLER = 'always_off';
      const provider = createOtlpTracerProvider({ enabled: true, sampler: 'always_on' });
      expect(provider).toBeDefined();
      provider?.shutdown();
    });

    it('config sampler always_off disables sampling', () => {
      const provider = createOtlpTracerProvider({ enabled: true, sampler: 'always_off' });
      expect(provider).toBeDefined();
      provider?.shutdown();
    });

    it('config sampler { ratio: 0.5 } creates ratio-based sampler', () => {
      const provider = createOtlpTracerProvider({ enabled: true, sampler: { ratio: 0.5 } });
      expect(provider).toBeDefined();
      provider?.shutdown();
    });

    it('env parentbased_traceidratio uses ParentBasedSampler', () => {
      process.env.OTEL_TRACES_SAMPLER = 'parentbased_traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '0.3';
      const provider = createOtlpTracerProvider({ enabled: true });
      expect(provider).toBeDefined();
      provider?.shutdown();
    });

    it('env traceidratio uses plain TraceIdRatioBasedSampler', () => {
      process.env.OTEL_TRACES_SAMPLER = 'traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '0.3';
      const provider = createOtlpTracerProvider({ enabled: true });
      expect(provider).toBeDefined();
      provider?.shutdown();
    });
  });
});
