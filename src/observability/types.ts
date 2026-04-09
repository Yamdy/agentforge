import { z } from 'zod';

// === Span Status ===
export const SpanStatusCodeSchema = z.enum(['UNSET', 'OK', 'ERROR']);
export type SpanStatusCode = z.infer<typeof SpanStatusCodeSchema>;

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

// === Span Attributes ===
export const GEN_AI_AGENT_NAME = 'gen_ai.agent.name';
export const GEN_AI_AGENT_ID = 'gen_ai.agent.id';
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
export const GEN_AI_REQUEST_TEMPERATURE = 'gen_ai.request.temperature';
export const GEN_AI_REQUEST_MAX_TOKENS = 'gen_ai.request.max_tokens';
export const GEN_AI_REQUEST_TOP_P = 'gen_ai.request.top_p';
export const GEN_AI_RESPONSE_ID = 'gen_ai.response.id';
export const GEN_AI_RESPONSE_FINISH_REASONS = 'gen_ai.response.finish_reasons';
export const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
export const GEN_AI_TOOL_NAME = 'gen_ai.tool.name';
export const GEN_AI_TOOL_DESCRIPTION = 'gen_ai.tool.description';
export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';
export const GEN_AI_PROVIDER_NAME = 'gen_ai.provider.name';

// === Span ===
export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  attributes: Record<string, string | number | boolean>;
  status: SpanStatus;
  startTime: Date;
  endTime?: Date;
  events: SpanEvent[];

  end(status?: SpanStatus): void;
  recordException(error: Error): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
  setAttribute(key: string, value: string | number | boolean): void;
}

export interface SpanEvent {
  name: string;
  time: Date;
  attributes?: Record<string, string | number | boolean>;
}

// === Exporter ===
export interface SpanExporter {
  export(spans: Span[]): Promise<void>;
  shutdown(): Promise<void>;
}

// === Config ===
export interface ObservabilityConfig {
  exporter?: SpanExporter;
  serviceName?: string;
  serviceVersion?: string;
}

export const ObservabilityConfigSchema = z.object({
  exporter: z.custom<SpanExporter>().optional(),
  serviceName: z.string().optional().default('agentforge'),
  serviceVersion: z.string().optional().default('0.1.0'),
});

// === Schemas export ===
export const schemas = {
  SpanStatusCode: SpanStatusCodeSchema,
  ObservabilityConfig: ObservabilityConfigSchema,
} as const;

export type Schemas = typeof schemas;
