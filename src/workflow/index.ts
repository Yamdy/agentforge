/**
 * AgentForge Workflow Subsystem
 *
 * High-level workflow orchestration above Agent.
 * Provides multi-step execution with suspend/resume capabilities.
 *
 * @example
 * ```typescript
 * import { Workflow, SequentialPipeline, ParallelPipeline } from 'agentforge/loop';
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
 * const events: AgentEvent[] = [];
 * const result = await workflow.run('AI trends', (event) => {
 *   events.push(event);
 *   console.log(event.type);
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
  // Declarative flow schemas
  StepFlowEntrySchema,
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
  // Workflow Event Types
  type WorkflowEvent,
  type WorkflowOrAgentEvent,
  // Declarative flow types
  type StepEntry,
  type BranchEntry,
  type ParallelEntry,
  type ForEachEntry,
  type StepFlowEntry,
  type PathSegment,
  // Helpers
  isWorkflowEvent,
  getWorkflowIdFromEvent,
  createStepOutputEntry,
} from './types.js';

// ============================================================
// Workflow Class
// ============================================================

export {
  Workflow,
  createWorkflow,
  type WorkflowCheckpointStorage,
  type WorkflowOptions,
} from './workflow.js';

// ============================================================
// Executor
// ============================================================

export {
  WorkflowExecutor,
  createPromptGenerator,
  createJsonPromptGenerator,
  type StepExecutionResult,
} from './executor.js';

// ============================================================
// Pipeline
// ============================================================

export {
  SequentialPipeline,
  ParallelPipeline,
  createPipeline,
  createSequentialPipeline,
  createParallelPipeline,
  type PipelineResult,
} from './pipeline.js';

// ============================================================
// Agent → Step Bridge
// ============================================================

export {
  createStepFromAgent,
  createWorkflowFromAgents,
  type AgentStepOptions,
  type AgentLike,
} from './agent-step.js';
