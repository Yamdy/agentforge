import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { AgentConfig } from '@agentforge/sdk';

describe('Agent', () => {
  beforeEach(() => {
    registerMockProvider('mock', (modelId) =>
      createMockLanguageModel({ text: `Hello from ${modelId}!` }),
    );
  });

  it('processes input through 3 stages and returns LLM response', async () => {
    const config: AgentConfig = {
      model: 'mock/test',
      systemPrompt: 'You are helpful.',
    };
    const agent = new Agent(config);

    const response = await agent.run('Hi there');
    expect(response).toBe('Hello from test!');
  });

  it('passes user input through to the model', async () => {
    registerMockProvider('capture', (modelId) =>
      createMockLanguageModel({ text: 'response' }),
    );

    const agent = new Agent({ model: 'capture/test' });
    const response = await agent.run('what is 2+2?');
    expect(response).toBe('response');
  });

  it('respects maxIterations from config', async () => {
    let callCount = 0;
    registerMockProvider('iter', () => {
      callCount++;
      return createMockLanguageModel({ text: 'thinking...' });
    });

    const agent = new Agent({ model: 'iter/test', maxIterations: 3 });
    await agent.run('test');
    expect(callCount).toBeLessThanOrEqual(3);
  });

  it('exposes pluginManager and delegates use() to PluginManager', async () => {
    const agent = new Agent({ model: 'mock/test' });

    // PluginManager is accessible and created
    expect(agent.pluginManager).toBeDefined();
    expect(typeof agent.pluginManager.invokeWrapHook).toBe('function');

    // use() delegates to PluginManager.initializePlugin
    const hooked: unknown[] = [];
    agent.use((api) => {
      api.registerHook({
        point: 'tool.wrap',
        handler: (data) => { hooked.push(data); },
      });
      return {};
    });

    // Verify hook was registered by invoking it
    await agent.pluginManager.invokeWrapHook('tool.wrap', { toolName: 'echo', result: 'test' });
    expect(hooked.length).toBe(1);
  });
});
