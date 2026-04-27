/**
 * AgentForge Loop Handlers - Re-exports
 *
 * All handler functions extracted from agent-loop.ts.
 * Each handler accepts HandlerDeps as first parameter for closure dependencies.
 *
 * @module
 */

// Lifecycle
export { handleAgentStart } from './lifecycle.js';

// LLM
export {
  handleLLMRequest,
  handleLLMResponse,
  handleLLMOutputInvalid,
  callLLM,
  callLLMStreaming,
  emitCheckpoint,
  estimateTokenCount,
  shouldCompact,
} from './llm.js';

// Tool Execution
export {
  handleToolCall,
  handleToolResult,
  handleBatchComplete,
  executeSingleTool,
  executeBatchTools,
  executeToolDirectly,
} from './tool-execution.js';

// HITL
export { handleHITLAsk } from './hitl.js';

// Subagent
export { handleSubagentDelegation } from './subagent.js';
