import type { ProcessorDeps, ProcessorFactory } from '@primo-ai/sdk';
import { globalProcessorRegistry } from '../processor-registry.js';

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

// Register all built-in processors with the global registry
import { processInputProcessor } from './process-input.js';
import { buildContextExtensionPoint } from './build-context.js';
import { prepareStepExtensionPoint } from './prepare-step.js';
import { createInvokeLLMProcessor } from './invoke-llm.js';
import { processStepOutputProcessor } from './process-step-output.js';
import { gateToolExtensionPoint } from './gate-tool.js';
import { createExecuteToolsProcessor } from './execute-tools.js';
import { createEvaluateIterationProcessor, evaluateIterationProcessor } from './evaluate-iteration.js';
import { processOutputProcessor } from './process-output.js';

globalProcessorRegistry.register('processInput', () => processInputProcessor);
globalProcessorRegistry.register('buildContext', () => buildContextExtensionPoint);
globalProcessorRegistry.register('prepareStep', () => prepareStepExtensionPoint);
globalProcessorRegistry.register('gateLLM', () => ({
  stage: 'gateLLM' as const,
  execute: async (ctx) => ctx.state,
  isNoOp: true,
}));
globalProcessorRegistry.register('invokeLLM', (deps?: ProcessorDeps) =>
  createInvokeLLMProcessor({
    getLLM: deps?.getLLM as any,
    registry: deps?.registry as any,
    hookManager: deps?.hookManager as any,
    modelString: deps?.modelString ?? '',
  }),
);
globalProcessorRegistry.register('processStepOutput', () => processStepOutputProcessor);
globalProcessorRegistry.register('gateTool', () => gateToolExtensionPoint);
globalProcessorRegistry.register('executeTools', (deps?: ProcessorDeps) =>
  createExecuteToolsProcessor(deps?.registry as any),
);
globalProcessorRegistry.register('evaluateIteration', (deps?: ProcessorDeps) =>
  createEvaluateIterationProcessor({ eventBus: deps?.eventBus as any }),
);
globalProcessorRegistry.register('processOutput', () => processOutputProcessor);
