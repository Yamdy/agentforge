/**
 * Contract Module - Tier 1 Validation
 *
 * Re-exports all validation functions and schemas for external data.
 * Tier 1: External untrusted data (LLM output, MCP response, user input)
 * must be validated with safeParse + fallback degradation.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN.md - Zod 数据契约层
 */

export {
  LLMResponseContractSchema,
  validateLLMResponse,
  extractToolCall,
  type LLMResponse,
} from './llm-contract.js';
export {
  MCPToolResponseSchema,
  validateMCPResponse,
  type MCPToolResponse,
} from './mcp-contract.js';
export { UserInputSchema, validateUserInput } from './user-input-contract.js';

// P1: Tool output validation
export {
  validateToolOutput,
  validateToolOutputForEvent,
  type ValidatedToolOutput,
} from './tool-output-contract.js';

// P1: Decision trace storage
export {
  InMemoryDecisionTraceStorage,
  createDecisionTraceStorage,
  createDecisionTrace,
  type DecisionTrace,
  type DecisionTraceFilter,
  type DecisionTraceStorage,
} from './decision-trace-storage.js';
