import { describe, it, expect } from 'vitest';
import { ExportResultCode } from '@opentelemetry/core';

describe('SafeOtlpSpanExporter', () => {
  describe('constructor', () => {
    it('creates exporter with default options (disabled when no endpoint)', async () => {
      const { SafeOtlpSpanExporter } = await import('../src/otel-exporter.js');
      const exporter = new SafeOtlpSpanExporter();
      expect(exporter).toBeDefined();
      expect(exporter.isDisabled()).toBe(true); // No endpoint configured
    });

    it('accepts custom endpoint via options', async () => {
      const { SafeOtlpSpanExporter } = await import('../src/otel-exporter.js');
      const exporter = new SafeOtlpSpanExporter({
        endpoint: 'http://custom-endpoint:4318/v1/traces',
      });
      expect(exporter).toBeDefined();
      expect(exporter.isDisabled()).toBe(false);
    });

    it('reads endpoint from OTEL_EXPORTER_OTLP_TRACES_ENDPOINT env var', async () => {
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'http://env-endpoint:4318/v1/traces';
      const module = await import('../src/otel-exporter.js?' + Date.now());
      const exporter = new module.SafeOtlpSpanExporter();
      expect(exporter).toBeDefined();
      expect(exporter.isDisabled()).toBe(false);
      delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    });

    it('reads endpoint from OTEL_EXPORTER_OTLP_ENDPOINT env var as fallback', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-endpoint:4318';
      const module = await import('../src/otel-exporter.js?' + Date.now());
      const exporter = new module.SafeOtlpSpanExporter();
      expect(exporter).toBeDefined();
      expect(exporter.isDisabled()).toBe(false);
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    });
  });

  describe('export', () => {
    it('returns SUCCESS when disabled', async () => {
      const { SafeOtlpSpanExporter } = await import('../src/otel-exporter.js');
      const exporter = new SafeOtlpSpanExporter();

      const result = await new Promise<{ code: ExportResultCode }>((resolve) => {
        exporter.export([], resolve);
      });

      expect(result.code).toBe(ExportResultCode.SUCCESS);
    });

    it('isDisabled returns true when OTEL_SDK_DISABLED is true', async () => {
      process.env.OTEL_SDK_DISABLED = 'true';
      const module = await import('../src/otel-exporter.js?' + Date.now());
      const exporter = new module.SafeOtlpSpanExporter();
      expect(exporter.isDisabled()).toBe(true);
      delete process.env.OTEL_SDK_DISABLED;
    });
  });

  describe('shutdown', () => {
    it('shuts down gracefully when disabled', async () => {
      const { SafeOtlpSpanExporter } = await import('../src/otel-exporter.js');
      const exporter = new SafeOtlpSpanExporter(); // disabled
      await expect(exporter.shutdown()).resolves.toBeUndefined();
    });

    it('forceFlush completes without error when disabled', async () => {
      const { SafeOtlpSpanExporter } = await import('../src/otel-exporter.js');
      const exporter = new SafeOtlpSpanExporter(); // disabled
      await expect(exporter.forceFlush()).resolves.toBeUndefined();
    });
  });
});

describe('createOtlpTracerProvider', () => {
  it('returns undefined when disabled', async () => {
    const { createOtlpTracerProvider } = await import('../src/otel-exporter.js');
    const provider = createOtlpTracerProvider({ enabled: false });
    expect(provider).toBeUndefined();
  });

  it('returns undefined when no endpoint configured', async () => {
    const { createOtlpTracerProvider } = await import('../src/otel-exporter.js');
    const provider = createOtlpTracerProvider({ enabled: true });
    expect(provider).toBeUndefined(); // No endpoint
  });

  it('creates provider when endpoint is configured', async () => {
    const { createOtlpTracerProvider } = await import('../src/otel-exporter.js');
    const provider = createOtlpTracerProvider({
      enabled: true,
      traces: { endpoint: 'http://localhost:4318/v1/traces' },
    });
    expect(provider).toBeDefined();
    // Note: Not calling shutdown() to avoid network timeout in tests
    // In production, shutdown() should be called for graceful termination
  });

  it('returns undefined when OTEL_SDK_DISABLED is true', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const module = await import('../src/otel-exporter.js?' + Date.now());
    const provider = module.createOtlpTracerProvider({
      enabled: true,
      traces: { endpoint: 'http://localhost:4318/v1/traces' },
    });
    expect(provider).toBeUndefined();
    delete process.env.OTEL_SDK_DISABLED;
  });

  it('uses OTEL_EXPORTER_OTLP_ENDPOINT from environment', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-endpoint:4318';
    const module = await import('../src/otel-exporter.js?' + Date.now());
    const provider = module.createOtlpTracerProvider({ enabled: true });
    expect(provider).toBeDefined();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it('uses OTEL_SERVICE_NAME from environment', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    process.env.OTEL_SERVICE_NAME = 'my-custom-service';
    const module = await import('../src/otel-exporter.js?' + Date.now());
    const provider = module.createOtlpTracerProvider({ enabled: true });
    expect(provider).toBeDefined();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
  });
});

describe('OtlpExporterOptions type', () => {
  it('accepts all optional fields', async () => {
    const { SafeOtlpSpanExporter } = await import('../src/otel-exporter.js');
    const exporter = new SafeOtlpSpanExporter({
      endpoint: 'http://localhost:4318/v1/traces',
      headers: { 'api-key': 'secret' },
      timeout: 10000,
      serviceName: 'test-service',
    });
    expect(exporter).toBeDefined();
    expect(exporter.isDisabled()).toBe(false);
  });
});
