import { describe, it, expect } from 'vitest';
import { globalProcessorRegistry } from '../src/processor-registry.js';
import type { BuiltinProcessorName, ProcessorDescriptor } from '@primo-ai/sdk';

describe('冗余3: 注册统一到 Agent.ensureProcessorsRegistered', () => {
  const allStages: BuiltinProcessorName[] = [
    'processInput', 'buildContext', 'prepareStep', 'gateLLM',
    'invokeLLM', 'processStepOutput', 'gateTool', 'executeTools',
    'evaluateIteration', 'processOutput',
  ];

  it('模块级 registerBuiltinProcessorsOnce 函数不应再导出', async () => {
    const agentModule = await import('../src/agent.js');
    expect((agentModule as any).registerBuiltinProcessorsOnce).toBeUndefined();
  });

  it('模块级 _builtinsRegistered 标志不应再存在', async () => {
    const agentModule = await import('../src/agent.js');
    expect((agentModule as any)._builtinsRegistered).toBeUndefined();
  });

  it('processors/index.ts 不再包含 globalProcessorRegistry 副作用', async () => {
    const mod = await import('../src/processors/index.js');
    // 模块应只有 re-export，没有 register 调用
    expect((mod as any).globalProcessorRegistry).toBeUndefined();
  });
});
