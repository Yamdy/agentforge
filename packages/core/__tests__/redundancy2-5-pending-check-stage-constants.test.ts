import { describe, it, expect, vi } from 'vitest';
import { LoopOrchestrator } from '../src/loop-orchestrator.js';
import { StateMachine } from '../src/state-machine.js';
import type { PipelineStageConfig, StageMutation } from '@primo-ai/sdk';

describe('冗余2: applyMutation pending 检查移除', () => {
  function createOrchestrator(stageConfig?: PipelineStageConfig): LoopOrchestrator {
    const runner = { run: vi.fn(), register: vi.fn(), getStages: vi.fn().mockReturnValue([]) } as any;
    const hookManager = { invoke: vi.fn().mockResolvedValue(undefined), register: vi.fn() } as any;
    return new LoopOrchestrator(runner, hookManager, undefined, undefined, stageConfig);
  }

  it('applyMutation 在 running 状态下应受 MutabilityPolicyEngine 控制（不再硬编码 pending 检查）', () => {
    const orch = createOrchestrator();
    const sm = (orch as any).stateMachine as StateMachine;
    sm.transition('running');

    const mutation: StageMutation = { type: 'insert', phase: 'loop', after: 'invokeLLM', stage: 'customStage' };
    expect(() => orch.applyMutation(mutation)).not.toThrow();
  });

  it('applyMutation 在 pending 状态下仍应正常工作', () => {
    const orch = createOrchestrator();
    const mutation: StageMutation = { type: 'insert', phase: 'loop', after: 'invokeLLM', stage: 'customStage' };
    expect(() => orch.applyMutation(mutation)).not.toThrow();
  });
});

describe('冗余5: 合并硬编码阶段常量', () => {
  function createOrchestrator(stageConfig?: PipelineStageConfig): LoopOrchestrator {
    const runner = { run: vi.fn(), register: vi.fn(), getStages: vi.fn().mockReturnValue([]) } as any;
    const hookManager = { invoke: vi.fn().mockResolvedValue(undefined), register: vi.fn() } as any;
    return new LoopOrchestrator(runner, hookManager, undefined, undefined, stageConfig);
  }

  it('LoopOrchestrator 默认阶段配置应包含正确的 preLoop/loop/postLoop', () => {
    const orch = createOrchestrator();
    const config = orch.stageConfig;
    expect(config.preLoop).toEqual(['processInput', 'buildContext']);
    expect(config.postLoop).toEqual(['processOutput']);
    expect(config.loop).toContain('invokeLLM');
    expect(config.loop).toContain('evaluateIteration');
  });

  it('LoopOrchestrator 应接受自定义 stageConfig 覆盖默认值', () => {
    const custom: PipelineStageConfig = {
      preLoop: ['processInput'],
      loop: ['invokeLLM'],
      postLoop: ['processOutput'],
    };
    const orch = createOrchestrator(custom);
    expect(orch.stageConfig.preLoop).toEqual(['processInput']);
    expect(orch.stageConfig.loop).toEqual(['invokeLLM']);
  });

  it('PRE_LOOP_STAGES / LOOP_STAGES / POST_LOOP_STAGES 常量不应被导出', async () => {
    const mod = await import('../src/loop-orchestrator.js');
    expect((mod as any).PRE_LOOP_STAGES).toBeUndefined();
    expect((mod as any).LOOP_STAGES).toBeUndefined();
    expect((mod as any).POST_LOOP_STAGES).toBeUndefined();
  });
});
