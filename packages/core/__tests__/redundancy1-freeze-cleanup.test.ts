import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HarnessAPIImpl } from '../src/harness.js';
import { MutabilityPolicyEngine } from '../src/mutability-policy.js';
import type { HarnessDeps } from '../src/harness.js';

function createMockDeps(): HarnessDeps {
  return {
    runner: { register: vi.fn() } as any,
    registry: { register: vi.fn(), unregister: vi.fn() } as any,
    hookManager: { register: vi.fn() } as any,
    eventSystem: {} as any,
    eventBus: { subscribe: vi.fn() } as any,
    emitEvent: vi.fn(),
    registerProvider: vi.fn(),
    mutateStages: vi.fn(),
  };
}

describe('冗余1: freeze() 统一到 MutabilityPolicyEngine', () => {
  let deps: HarnessDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('默认无策略时 insertStage 应被拒绝（等价于旧 frozen 行为）', () => {
    const harness = new HarnessAPIImpl(deps);
    expect(() => harness.insertStage('loop', 'invokeLLM', 'customStage')).toThrow();
  });

  it('dynamic 策略下 insertStage 应成功', () => {
    const harness = new HarnessAPIImpl(deps);
    const policy = new MutabilityPolicyEngine('dynamic');
    harness.setMutabilityPolicy(policy);
    expect(() => harness.insertStage('loop', 'invokeLLM', 'customStage')).not.toThrow();
  });

  it('frozen 策略下 insertStage 应被拒绝', () => {
    const harness = new HarnessAPIImpl(deps);
    const policy = new MutabilityPolicyEngine('frozen');
    harness.setMutabilityPolicy(policy);
    expect(() => harness.insertStage('loop', 'invokeLLM', 'customStage')).toThrow();
  });

  it('configOnly 策略下 insertStage 直接修改应被拒绝', () => {
    const harness = new HarnessAPIImpl(deps);
    const policy = new MutabilityPolicyEngine({ pipeline: 'configOnly', processors: 'frozen', plugins: 'frozen', tools: 'frozen', hotReload: true, watchConfig: false });
    harness.setMutabilityPolicy(policy);
    expect(() => harness.insertStage('loop', 'invokeLLM', 'customStage')).toThrow();
  });

  it('removeStage 同样遵循 MutabilityPolicyEngine 策略', () => {
    const harness = new HarnessAPIImpl(deps);
    const policy = new MutabilityPolicyEngine('dynamic');
    harness.setMutabilityPolicy(policy);
    expect(() => harness.removeStage('loop', 'gateLLM')).not.toThrow();
  });

  it('replaceStages 同样遵循 MutabilityPolicyEngine 策略', () => {
    const harness = new HarnessAPIImpl(deps);
    const policy = new MutabilityPolicyEngine('dynamic');
    harness.setMutabilityPolicy(policy);
    expect(() => harness.replaceStages('loop', ['invokeLLM'])).not.toThrow();
  });

  it('freeze() 方法不应再存在', () => {
    const harness = new HarnessAPIImpl(deps);
    expect((harness as any).freeze).toBeUndefined();
  });

  it('frozen 字段不应再存在', () => {
    const harness = new HarnessAPIImpl(deps);
    expect((harness as any).frozen).toBeUndefined();
  });
});
