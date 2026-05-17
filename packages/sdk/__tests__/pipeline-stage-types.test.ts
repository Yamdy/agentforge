import { describe, it, expect } from 'vitest';
import type { PipelineStage, ToolExecutionStage, StageName } from '../src/index.js';

// ---------------------------------------------------------------------------
// PipelineStage — reduced to 10 main stages, excludes tool sub-pipeline
// ---------------------------------------------------------------------------

describe('PipelineStage (reduced)', () => {
  it('has exactly 10 main stage names', () => {
    const stages: PipelineStage[] = [
      'processInput',
      'buildContext',
      'prepareStep',
      'gateLLM',
      'invokeLLM',
      'processStepOutput',
      'gateTool',
      'executeTools',
      'evaluateIteration',
      'processOutput',
    ];
    expect(stages).toHaveLength(10);
  });

  it('rejects beforeTool at the type level', () => {
    // Before PipelineStage reduction: 'beforeTool' IS assignable ⇒ @ts-expect-error is unused ⇒ TYPE ERROR ⇒ RED
    // After PipelineStage reduction: 'beforeTool' is NOT assignable ⇒ @ts-expect-error suppresses the error ⇒ GREEN
    const acceptPipelineStage = (_stage: PipelineStage): void => {};
    // @ts-expect-error — PipelineStage excludes beforeTool
    acceptPipelineStage('beforeTool');
    expect(true).toBe(true);
  });

  it('rejects execute at the type level', () => {
    const acceptPipelineStage = (_stage: PipelineStage): void => {};
    // @ts-expect-error — PipelineStage excludes execute
    acceptPipelineStage('execute');
    expect(true).toBe(true);
  });

  it('rejects afterTool at the type level', () => {
    const acceptPipelineStage = (_stage: PipelineStage): void => {};
    // @ts-expect-error — PipelineStage excludes afterTool
    acceptPipelineStage('afterTool');
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ToolExecutionStage — new separate union for tool sub-pipeline
// ---------------------------------------------------------------------------

describe('ToolExecutionStage', () => {
  it('accepts beforeTool, execute, afterTool', () => {
    const stages: ToolExecutionStage[] = ['beforeTool', 'execute', 'afterTool'];
    expect(stages).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// StageName — backward compatibility: still accepts everything
// ---------------------------------------------------------------------------

describe('StageName backward compatibility', () => {
  it('accepts all PipelineStage values', () => {
    const names: StageName[] = [
      'processInput',
      'buildContext',
      'prepareStep',
      'gateLLM',
      'invokeLLM',
      'processStepOutput',
      'gateTool',
      'executeTools',
      'evaluateIteration',
      'processOutput',
    ];
    expect(names).toHaveLength(10);
  });

  it('accepts all ToolExecutionStage values (backward compat)', () => {
    const names: StageName[] = ['beforeTool', 'execute', 'afterTool'];
    expect(names).toHaveLength(3);
  });

  it('accepts arbitrary plugin-defined strings', () => {
    const custom: StageName = 'my-custom-plugin-stage';
    expect(custom).toBe('my-custom-plugin-stage');
  });

  it('accepts all old values including tool stages at the type level', () => {
    const acceptAnyStage = (_stage: StageName): void => {};
    // These should always compile — StageName must include tool stages
    acceptAnyStage('processInput');
    acceptAnyStage('beforeTool');
    acceptAnyStage('execute');
    acceptAnyStage('afterTool');
    expect(true).toBe(true);
  });
});
