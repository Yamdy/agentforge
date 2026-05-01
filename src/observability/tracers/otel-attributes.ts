/**
 * OTel Span Attribute Constants
 *
 * Follows OpenTelemetry GenAI Semantic Conventions for LLM operations,
 * plus AgentForge-custom attributes for framework-specific metadata.
 * Modeled after AgentScope's SpanAttributes class.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 * @module observability/tracers/otel-attributes
 */

// ============================================================
// Standard GenAI Attributes (from OTel semconv)
// ============================================================

/** Operation type for the span */
export const ATTR_OPERATION = 'gen_ai.operation.name';
/** Provider name (e.g., openai, anthropic) */
export const ATTR_PROVIDER = 'gen_ai.provider.name';
/** Model name used for the request */
export const ATTR_REQUEST_MODEL = 'gen_ai.request.model';
/** Input token count */
export const ATTR_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
/** Output token count */
export const ATTR_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
/** Agent unique identifier */
export const ATTR_AGENT_ID = 'gen_ai.agent.id';
/** Agent human-readable name */
export const ATTR_AGENT_NAME = 'gen_ai.agent.name';
/** Agent description string */
export const ATTR_AGENT_DESCRIPTION = 'gen_ai.agent.description';
/** Tool name being executed */
export const ATTR_TOOL_NAME = 'gen_ai.tool.name';
/** Number of messages in the request */
export const ATTR_REQUEST_MESSAGES_COUNT = 'gen_ai.request.messages_count';
/** Maximum tokens configured for the request */
export const ATTR_REQUEST_MAX_TOKENS = 'gen_ai.request.max_tokens';
/** Number of tools available to the LLM */
export const ATTR_REQUEST_TOOLS_COUNT = 'gen_ai.request.tools_count';
/** Size of tool arguments in bytes */
export const ATTR_TOOL_ARGUMENTS_SIZE = 'gen_ai.tool.arguments_size';

// ============================================================
// AgentForge Custom Attributes
// ============================================================

/** Agent run unique identifier */
export const ATTR_AGENTFORGE_RUN_ID = 'agentforge.run.id';
/** Agent loop step number */
export const ATTR_AGENTFORGE_STEP = 'agentforge.step';
/** Event type that triggered this span */
export const ATTR_AGENTFORGE_EVENT = 'agentforge.event';
/** Tool execution result summary */
export const ATTR_AGENTFORGE_TOOL_RESULT = 'agentforge.tool.result';
/** Error code for agent.error events */
export const ATTR_AGENTFORGE_ERROR_CODE = 'agentforge.error.code';

// ============================================================
// Operation Name Values
// ============================================================

/** LLM chat completion */
export const OPERATION_CHAT = 'chat';
/** Tool execution */
export const OPERATION_EXECUTE_TOOL = 'execute_tool';
/** Full agent run */
export const OPERATION_AGENT_RUN = 'run';
/** Single agent loop step */
export const OPERATION_AGENT_STEP = 'step';

// ============================================================
// Attribute Extractors
// ============================================================

/**
 * Input parameters for LLM request attribute extraction.
 */
export interface LLMRequestInfo {
  model: string;
  provider: string;
  messagesCount: number;
  toolsCount?: number;
  maxTokens?: number;
}

/**
 * Extract attributes for LLM request spans.
 * Mirror of AgentScope's _get_llm_request_attributes().
 */
export function extractLLMAttributes(request: LLMRequestInfo): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    [ATTR_OPERATION]: OPERATION_CHAT,
    [ATTR_PROVIDER]: request.provider,
    [ATTR_REQUEST_MODEL]: request.model,
    [ATTR_REQUEST_MESSAGES_COUNT]: request.messagesCount,
    [ATTR_REQUEST_MAX_TOKENS]: request.maxTokens ?? 0,
  };
  if (request.toolsCount !== undefined && request.toolsCount > 0) {
    attrs[ATTR_REQUEST_TOOLS_COUNT] = request.toolsCount;
  }
  return attrs;
}

/**
 * Input parameters for tool execution attribute extraction.
 */
export interface ToolExecutionInfo {
  name: string;
  argumentsSize: number;
}

/**
 * Extract attributes for tool execution spans.
 * Mirror of AgentScope's _get_tool_request_attributes().
 */
export function extractToolAttributes(tool: ToolExecutionInfo): Record<string, string | number> {
  return {
    [ATTR_OPERATION]: OPERATION_EXECUTE_TOOL,
    [ATTR_TOOL_NAME]: tool.name,
    [ATTR_TOOL_ARGUMENTS_SIZE]: tool.argumentsSize,
  };
}
