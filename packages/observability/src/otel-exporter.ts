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
} from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

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

  const provider = new BasicTracerProvider({
    resource,
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
