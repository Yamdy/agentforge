// Re-export all processors for backward compatibility
export { processInputProcessor } from './process-input.js';
export { buildContextExtensionPoint } from './build-context.js';
export { prepareStepExtensionPoint } from './prepare-step.js';
export { createInvokeLLMProcessor, type InvokeLLMDeps } from './invoke-llm.js';
export { processStepOutputProcessor } from './process-step-output.js';
export { gateToolExtensionPoint } from './gate-tool.js';
export { createExecuteToolsProcessor } from './execute-tools.js';
export { createEvaluateIterationProcessor, evaluateIterationProcessor } from './evaluate-iteration.js';
export { processOutputProcessor } from './process-output.js';
export { createCompressContextProcessor } from './compress-context.js';
