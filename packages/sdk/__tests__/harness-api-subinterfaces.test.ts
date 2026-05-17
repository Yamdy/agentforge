import { describe, it, expect } from 'vitest';
import type {
  HarnessAPI,
  PipelineRegistry,
  ToolRegistryAPI,
  InterceptionAPI,
  StageMutationAPI,
  LifecycleAPI,
  Processor,
  ToolDefinition,
  Hook,
  ResourceDeclaration,
} from '../src/index.js';

describe('HarnessAPI sub-interfaces', () => {
  it('HarnessAPI extends PipelineRegistry', () => {
    const fn = (api: HarnessAPI): PipelineRegistry => api;
    expect(fn).toBeDefined();
  });

  it('HarnessAPI extends ToolRegistryAPI', () => {
    const fn = (api: HarnessAPI): ToolRegistryAPI => api;
    expect(fn).toBeDefined();
  });

  it('HarnessAPI extends InterceptionAPI', () => {
    const fn = (api: HarnessAPI): InterceptionAPI => api;
    expect(fn).toBeDefined();
  });

  it('HarnessAPI extends StageMutationAPI', () => {
    const fn = (api: HarnessAPI): StageMutationAPI => api;
    expect(fn).toBeDefined();
  });

  it('HarnessAPI extends LifecycleAPI', () => {
    const fn = (api: HarnessAPI): LifecycleAPI => api;
    expect(fn).toBeDefined();
  });

  it('PipelineRegistry has registerProcessor method — type level', () => {
    const fn = (reg: PipelineRegistry) => {
      reg.registerProcessor('processInput', {} as Processor);
    };
    expect(typeof fn).toBe('function');
  });

  it('ToolRegistryAPI has registerTool and unregisterTool — type level', () => {
    const fn = (reg: ToolRegistryAPI) => {
      reg.registerTool({} as ToolDefinition);
      reg.unregisterTool('test');
    };
    expect(typeof fn).toBe('function');
  });

  it('InterceptionAPI has registerHook, subscribe, emit — type level', () => {
    const fn = (api: InterceptionAPI) => {
      api.registerHook({} as Hook);
      api.subscribe('test', () => {});
      api.emit('test');
    };
    expect(typeof fn).toBe('function');
  });

  it('StageMutationAPI has insertStage, removeStage, replaceStages — type level', () => {
    const fn = (api: StageMutationAPI) => {
      api.insertStage('preLoop', 'processInput', 'customStage');
      api.removeStage('loop', 'invokeLLM');
      api.replaceStages('postLoop', ['processOutput']);
    };
    expect(typeof fn).toBe('function');
  });

  it('LifecycleAPI has registerResource, registerProvider, registerCompressionStrategy, registerCommand — type level', () => {
    const fn = (api: LifecycleAPI) => {
      api.registerResource({} as ResourceDeclaration);
      api.registerProvider('test', {});
      api.registerCommand('cmd', async (_args: string) => {});
    };
    expect(typeof fn).toBe('function');
  });
});
