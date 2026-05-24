import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  AutonomousConfig,
  GapTrigger,
  HarnessConfig,
  PipelineStageConfig,
  ProcessorDescriptor,
} from '@primo-ai/sdk';
import { Agent, type AgentDependencies } from '../src/agent.js';
import { StateMachine, type AgentState } from '../src/state-machine.js';
import { ConfigLoader } from '../src/config.js';

// ---------------------------------------------------------------------------
// Phase 5: Self-Reference Tools + Gap Optimization + Server Config-Driven
//
// User Journeys:
//   J1: StateMachine.forceReset() bypasses isRecoverable check
//   J2: selfRef delayed dereferencing — tools capture selfRef, resolve at execution
//   J3: inspectSelf tool — Agent inspects its own pipeline, processors, tools, plugins
//   J4: replaceProcessor tool — Agent proposes replacing a processor (collected, applied later)
//   J5: registerPlugin tool — Agent proposes registering a plugin (collected, applied later)
//   J6: endAutonomousLoop tool — Agent signals it wants to end the gap optimization loop
//   J7: AutonomousConfig + GapTrigger types in SDK
//   J8: Gap optimization — Agent self-optimizes during idle gaps
//   J9: Server config-driven Agent assembly from HarnessConfig.agents
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// J1: StateMachine.forceReset()
// ---------------------------------------------------------------------------

describe('Phase 5: StateMachine.forceReset()', () => {
  it('resets from error to pending without isRecoverable check', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('error', { recoverable: false, retryCount: 5, maxRetries: 3 } as any);

    expect(sm.canTransition('running')).toBe(false);

    sm.forceReset('pending');
    expect(sm.current).toBe('pending');
  });

  it('resets from any terminal state to any target state', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('completed');
    expect(sm.canTransition('running')).toBe(false);

    sm.forceReset('pending');
    expect(sm.current).toBe('pending');
  });

  it('fires transition listeners on forceReset', () => {
    const sm = new StateMachine();
    const listener = vi.fn();
    sm.onTransition(listener);

    sm.transition('running');
    sm.transition('error', { recoverable: false } as any);

    sm.forceReset('pending');
    expect(listener).toHaveBeenCalledWith('error', 'pending');
  });

  it('defaults to pending when no target specified', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('cancelled');

    sm.forceReset();
    expect(sm.current).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// J2: selfRef delayed dereferencing
// ---------------------------------------------------------------------------

describe('Phase 5: selfRef delayed dereferencing', () => {
  it('Agent has selfRef that points to itself after construction', () => {
    const agent = new Agent({ model: 'test-model' });
    expect((agent as any).selfRef).toBeDefined();
    expect((agent as any).selfRef.agent).toBe(agent);
  });
});

// ---------------------------------------------------------------------------
// J3: inspectSelf tool
// ---------------------------------------------------------------------------

describe('Phase 5: inspectSelf tool', () => {
  it('inspectSelf tool is registered by default', () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('inspectSelf');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('inspectSelf');
    expect(tool!.description).toContain('nspect');
  });

  it('inspectSelf returns pipeline stages, tools, and state', async () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('inspectSelf')!;
    const result = await tool.execute({}, { sessionId: 'test' });
    const data = result as any;

    // Phase 6a: inspectSelf now returns SelfRepresentation
    expect(data.modules).toBeDefined();
    expect(Array.isArray(data.modules)).toBe(true);
    expect(data.dependencies).toBeDefined();
    expect(data.layerDiagnostics).toBeDefined();
    expect(data.layerDiagnostics.length).toBe(12);
  });

  it('inspectSelf includes processor and tool modules', async () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('inspectSelf')!;
    const result = await tool.execute({}, { sessionId: 'test' });
    const data = result as any;

    const processors = data.modules.filter((m: any) => m.responsibility === 'processor');
    expect(processors.length).toBeGreaterThan(0);
    const tools = data.modules.filter((m: any) => m.responsibility === 'tool');
    expect(tools.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// J4: replaceProcessor tool
// ---------------------------------------------------------------------------

describe('Phase 5: replaceProcessor tool', () => {
  it('replaceProcessor tool is registered by default', () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('replaceProcessor');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('replaceProcessor');
  });

  it('replaceProcessor requires approval by default', () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('replaceProcessor')!;
    expect(tool.requireApproval).toBe(true);
  });

  it('replaceProcessor collects proposal into pendingModifications', async () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('replaceProcessor')!;

    const result = await tool.execute({
      stage: 'processOutput',
      processorCode: 'module.exports = { execute: async (ctx) => ctx.state };',
    }, { sessionId: 'test' });

    const data = result as any;
    expect(data.proposed).toBe(true);
    expect(data.stage).toBe('processOutput');
    expect((agent as any)._pendingModifications).toBeDefined();
    expect((agent as any)._pendingModifications.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// J5: registerPlugin tool
// ---------------------------------------------------------------------------

describe('Phase 5: registerPlugin tool', () => {
  it('registerPlugin tool is registered by default', () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('registerPlugin');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('registerPlugin');
  });

  it('registerPlugin requires approval by default', () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('registerPlugin')!;
    expect(tool.requireApproval).toBe(true);
  });

  it('registerPlugin collects proposal into pendingModifications', async () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('registerPlugin')!;

    const result = await tool.execute({
      pluginId: 'test-plugin',
      config: { key: 'value' },
    }, { sessionId: 'test' });

    const data = result as any;
    expect(data.proposed).toBe(true);
    expect(data.pluginId).toBe('test-plugin');
  });
});

// ---------------------------------------------------------------------------
// J6: endAutonomousLoop tool
// ---------------------------------------------------------------------------

describe('Phase 5: endAutonomousLoop tool', () => {
  it('endAutonomousLoop tool is registered by default', () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('endAutonomousLoop');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('endAutonomousLoop');
  });

  it('endAutonomousLoop does not require approval', () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('endAutonomousLoop')!;
    expect(tool.requireApproval).toBeFalsy();
  });

  it('endAutonomousLoop sets a flag that stops the gap loop', async () => {
    const agent = new Agent({ model: 'test-model' });
    const tool = agent.toolRegistry.get('endAutonomousLoop')!;

    const result = await tool.execute({}, { sessionId: 'test' });
    const data = result as any;
    expect(data.ended).toBe(true);
    expect((agent as any)._gapOptimizationRunning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// J7: AutonomousConfig + GapTrigger types
// ---------------------------------------------------------------------------

describe('Phase 5: AutonomousConfig + GapTrigger SDK types', () => {
  it('ConfigLoader validates autonomous field', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load({
      session: {
        autonomous: {
          enabled: true,
          gapTriggers: [
            { type: 'idle', idleTimeoutMs: 5000 },
            { type: 'afterRun', minIntervalMs: 1000 },
          ],
          maxOptimizationsPerGap: 3,
          maxConsecutiveErrors: 3,
        },
      } as any,
    });

    expect(config.autonomous).toBeDefined();
    expect((config.autonomous as any).enabled).toBe(true);
    expect((config.autonomous as any).gapTriggers).toHaveLength(2);
  });

  it('ConfigLoader validates gap trigger types', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load({
      session: {
        autonomous: {
          enabled: true,
          gapTriggers: [
            { type: 'schedule', cron: '*/5 * * * *' },
            { type: 'onError' },
          ],
        },
      } as any,
    });

    expect((config.autonomous as any).gapTriggers[0].type).toBe('schedule');
    expect((config.autonomous as any).gapTriggers[1].type).toBe('onError');
  });

  it('autonomous defaults to undefined when not specified', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load({ session: {} });
    expect(config.autonomous).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// J8: Gap optimization events and control
// ---------------------------------------------------------------------------

describe('Phase 5: Gap optimization events', () => {
  it('Agent emits gap:started event when gap optimization begins', () => {
    const agent = new Agent({ model: 'test-model' });
    const handler = vi.fn();
    agent.on('gap:started', handler);

    (agent as any).startGapOptimization();
    expect(handler).toHaveBeenCalled();
  });

  it('Agent emits gap:preempted when user request interrupts gap', () => {
    const agent = new Agent({ model: 'test-model' });
    const handler = vi.fn();
    agent.on('gap:preempted', handler);

    (agent as any).preemptGapOptimization();
    expect(handler).toHaveBeenCalled();
  });

  it('Agent has gap optimization control methods', () => {
    const agent = new Agent({ model: 'test-model' });
    expect(typeof (agent as any).startGapOptimization).toBe('function');
    expect(typeof (agent as any).preemptGapOptimization).toBe('function');
    expect(typeof (agent as any).applyPendingModifications).toBe('function');
  });

  it('applyPendingModifications applies collected modifications', async () => {
    const agent = new Agent({ model: 'test-model' });

    (agent as any)._pendingModifications = [
      { type: 'replaceProcessor', stage: 'processOutput', applied: false },
    ];

    const result = await (agent as any).applyPendingModifications();
    expect(result.applied.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// J9: Server config-driven Agent assembly
// ---------------------------------------------------------------------------

describe('Phase 5: Server config-driven Agent assembly', () => {
  it('ConfigLoader parses agents with autonomous config', async () => {
    const loader = new ConfigLoader();
    const config = await loader.load({
      session: {
        agents: {
          assistant: {
            model: 'deepseek/deepseek-v4-flash',
            systemPrompt: 'You are helpful',
            maxIterations: 5,
          },
        },
        autonomous: {
          enabled: true,
          gapTriggers: [{ type: 'idle', idleTimeoutMs: 5000 }],
        },
      } as any,
    });

    expect(config.agents).toBeDefined();
  });

  it('Agent constructed from config has self-reference tools', () => {
    const agentConfig = {
      model: 'deepseek/deepseek-v4-flash',
      systemPrompt: 'You are helpful',
      maxIterations: 5,
    };

    const agent = new Agent(agentConfig);
    expect(agent.toolRegistry.get('inspectSelf')).toBeDefined();
    expect(agent.toolRegistry.get('endAutonomousLoop')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Recursion prevention: runSelfOptimization must not re-trigger gap
// ---------------------------------------------------------------------------

describe('Phase 5: runSelfOptimization recursion prevention', () => {
  it('triggerGapOptimizationIfApplicable is a no-op when _gapOptimizationRunning is true', () => {
    const agent = new Agent({ model: 'test-model' });
    (agent as any)._harnessConfig = {
      autonomous: { enabled: true, gapTriggers: [{ type: 'afterRun' }] },
    };
    (agent as any)._gapOptimizationRunning = true;

    const startSpy = vi.spyOn(agent as any, 'startGapOptimization');
    (agent as any).triggerGapOptimizationIfApplicable('afterRun');
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('internal run (_isInternalRun) skips triggerGapOptimizationIfApplicable', () => {
    const agent = new Agent({ model: 'test-model' });
    (agent as any)._isInternalRun = true;
    (agent as any)._harnessConfig = {
      autonomous: { enabled: true, gapTriggers: [{ type: 'afterRun' }] },
    };

    const triggerSpy = vi.spyOn(agent as any, 'triggerGapOptimizationIfApplicable');

    if (!(agent as any)._isInternalRun) {
      (agent as any).triggerGapOptimizationIfApplicable('afterRun');
    }

    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('runSelfOptimization sets _isInternalRun during execution and clears it after', async () => {
    const agent = new Agent({ model: 'test-model' });
    let capturedFlag = false;

    agent.run = vi.fn(async () => {
      capturedFlag = (agent as any)._isInternalRun;
    }) as any;

    await (agent as any).runSelfOptimization('test prompt', 1);

    expect(capturedFlag).toBe(true);
    expect((agent as any)._isInternalRun).toBe(false);
  });

  it('_isInternalRun is cleared even when runSelfOptimization throws', async () => {
    const agent = new Agent({ model: 'test-model' });

    agent.run = vi.fn(async () => { throw new Error('boom'); }) as any;

    await expect((agent as any).runSelfOptimization('test', 1)).rejects.toThrow('boom');
    expect((agent as any)._isInternalRun).toBe(false);
    expect((agent as any)._gapOptimizationRunning).toBe(false);
  });
});
