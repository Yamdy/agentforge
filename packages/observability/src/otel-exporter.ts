/**
 * OTLP Exporter for AgentForge observability
 *
 * Provides safe OTLP HTTP export with graceful error handling.
 * References:
 * - CrewAI SafeOTLPSpanExporter pattern
 * - OpenTelemetry OTLP HTTP specification
 */

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExportResultCode } from '@opentelemetry/core';
import { Resource } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan, SpanExporter, Sampler } from '@opentelemetry/sdk-trace-base';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OtlpExporterOptions {
  /** OTLP endpoint URL. Defaults to OTEL_EXPORTER_OTLP_TRACES_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT */
  endpoint?: string;
  /** Custom headers for authentication */
  headers?: Record<string, string>;
  /** Export timeout in milliseconds. Default: 30000 */
  timeout?: number;
  /** Service name for resource attributes. Default: 'agentforge' or OTEL_SERVICE_NAME */
  serviceName?: string;
}

export interface OtlpExporterConfig {
  /** Whether OTLP export is enabled */
  enabled: boolean;
  /** Traces exporter options */
  traces?: OtlpExporterOptions;
  /** Sampling strategy. Default: 'always_on'. Use { ratio: 0.0-1.0 } for probabilistic. */
  sampler?: 'always_on' | 'always_off' | { ratio: number };
}

// ---------------------------------------------------------------------------
// Environment Variable Helpers
// ---------------------------------------------------------------------------

function getEnvString(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

function getEnvBoolean(key: string, defaultValue = false): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

function isOtelDisabled(): boolean {
  return getEnvBoolean('OTEL_SDK_DISABLED', false);
}

function resolveEndpoint(options?: OtlpExporterOptions): string | undefined {
  if (options?.endpoint) return options.endpoint;
  const tracesEndpoint = getEnvString('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT');
  if (tracesEndpoint) return tracesEndpoint;
  const baseEndpoint = getEnvString('OTEL_EXPORTER_OTLP_ENDPOINT');
  if (baseEndpoint) return baseEndpoint.replace(/\/$/, '') + '/v1/traces';
  return undefined;
}

function resolveServiceName(options?: OtlpExporterOptions): string {
  const envValue = getEnvString('OTEL_SERVICE_NAME');
  if (options?.serviceName) return options.serviceName;
  if (envValue) return envValue;
  return 'agentforge';
}

// ── Sampling ──────────────────────────────────────────────────

const VALID_SAMPLERS = new Set(['always_on', 'always_off', 'parentbased_traceidratio', 'traceidratio']);

/**
 * Resolve the sampler type from env or config.
 * Returns 'always_on', 'always_off', or 'parentbased_traceidratio'.
 */
export function resolveSampler(): string {
  const env = getEnvString('OTEL_TRACES_SAMPLER');
  if (!env) return 'always_on';
  if (VALID_SAMPLERS.has(env)) return env;
  return 'always_on';
}

/**
 * Resolve the sampler ratio from env OTEL_TRACES_SAMPLER_ARG.
 * Returns a value between 0.0 and 1.0. Default: 1.0.
 */
export function resolveSamplerRatio(): number {
  const raw = getEnvString('OTEL_TRACES_SAMPLER_ARG');
  if (!raw) return 1.0;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return 1.0;
  return Math.max(0, Math.min(1, n));
}

// ---------------------------------------------------------------------------
// SafeOtlpSpanExporter
// ---------------------------------------------------------------------------

/**
 * Safe wrapper around OTLPTraceExporter that handles errors gracefully.
 * Network failures are logged but do not throw or affect the main application flow.
 */
export class SafeOtlpSpanExporter implements SpanExporter {
  private readonly exporter: OTLPTraceExporter | undefined;
  private readonly disabled: boolean;

  constructor(options?: OtlpExporterOptions) {
    this.disabled = isOtelDisabled();

    if (this.disabled) {
      this.exporter = undefined;
      return;
    }

    const endpoint = resolveEndpoint(options);
    if (!endpoint) {
      this.exporter = undefined;
      return;
    }

    try {
      this.exporter = new OTLPTraceExporter({
        url: endpoint,
        headers: options?.headers,
        timeoutMillis: options?.timeout ?? 30000,
      });
    } catch {
      this.exporter = undefined;
    }
  }

  isDisabled(): boolean {
    return this.disabled || this.exporter === undefined;
  }

  export(spans: ReadableSpan[], resultCallback: (result: { code: ExportResultCode; error?: Error }) => void): void {
    if (this.disabled || !this.exporter) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    try {
      this.exporter.export(spans, resultCallback);
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  async forceFlush(): Promise<void> {
    if (this.disabled || !this.exporter) return;

    try {
      await this.exporter.forceFlush?.();
    } catch {
      // Silently ignore flush errors
    }
  }

  async shutdown(): Promise<void> {
    if (this.disabled || !this.exporter) return;

    try {
      await this.exporter.shutdown();
    } catch {
      // Silently ignore shutdown errors
    }
  }
}

// ---------------------------------------------------------------------------
// createOtlpTracerProvider
// ---------------------------------------------------------------------------

/**
 * Create a TracerProvider configured with OTLP export.
 * Returns undefined if OTel is disabled or configuration is invalid.
 */
export function createOtlpTracerProvider(config: OtlpExporterConfig): BasicTracerProvider | undefined {
  if (!config.enabled || isOtelDisabled()) {
    return undefined;
  }

  const serviceName = resolveServiceName(config.traces);
  const exporter = new SafeOtlpSpanExporter(config.traces);

  if (exporter.isDisabled()) {
    return undefined;
  }

  const resource = new Resource({
    'service.name': serviceName,
  });

  const sampler = resolveSamplerFromConfig(config);

  const provider = new BasicTracerProvider({
    resource,
    sampler,
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 30000,
      }),
    ],
  });

  return provider;
}

/**
 * Build an OTel Sampler from config + env vars.
 */
function resolveSamplerFromConfig(config: OtlpExporterConfig): Sampler {
  // Config-level sampler takes precedence over env
  if (config.sampler) {
    if (config.sampler === 'always_on') return new AlwaysOnSampler();
    if (config.sampler === 'always_off') return new AlwaysOffSampler();
    return new TraceIdRatioBasedSampler(config.sampler.ratio);
  }

  const envSampler = resolveSampler();
  if (envSampler === 'always_off') return new AlwaysOffSampler();
  if (envSampler === 'always_on') return new AlwaysOnSampler();
  if (envSampler === 'parentbased_traceidratio') {
    return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(resolveSamplerRatio()) });
  }
  // traceidratio
  return new TraceIdRatioBasedSampler(resolveSamplerRatio());
}
