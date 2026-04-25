/**
 * AgentForge Workflow Subsystem
 *
 * High-level workflow orchestration above Agent.
 * Provides multi-step execution with suspend/resume capabilities.
 *
 * @example
 * ```typescript
 * import { Workflow, SequentialPipeline, ParallelPipeline } from 'agentforge/workflow';
 *
 * // Create a workflow
 * const workflow = new Workflow({
 *   id: 'research-workflow',
 *   name: 'Research Workflow',
 *   steps: [
 *     { id: 'search', prompt: (input) => `Search for: ${input}` },
 *     { id: 'analyze', prompt: (input) => `Analyze: ${input}` },
 *   ],
 * }, agentContext);
 *
 * // Run workflow
 * workflow.run('AI trends').subscribe({
 *   next: (event) => console.log(event.type),
 * });
 * ```
 *
 * @module
 */

// ============================================================
// Types
// ============================================================

export {
  // Schemas
  WorkflowStepSchema,
  WorkflowConfigSchema,
  WorkflowExecutionStateSchema,
  PipelineModeSchema,
  // Types
  type WorkflowStep,
  type WorkflowStepWithAgent,
  type WorkflowConfig,
  type WorkflowExecutionState,
  type WorkflowExecutionContext,
  type WorkflowResult,
  type WorkflowStepResult,
  type PipelineMode,
  type PipelineConfig,
  // Helpers
  isWorkflowEvent,
  getWorkflowIdFromEvent,
  createStepOutputEntry,
} from './types.js';

// ============================================================
// Workflow Class
// ============================================================

export { Workflow, createWorkflow } from './workflow.js';

// ============================================================
// Executor
// ============================================================

export { WorkflowExecutor, createPromptGenerator, createJsonPromptGenerator } from './executor.js';

// ============================================================
// Pipeline
// ============================================================

export {
  SequentialPipeline,
  ParallelPipeline,
  createPipeline,
  createSequentialPipeline,
  createParallelPipeline,
} from './pipeline.js';
