import { describe, it, expect, vi } from 'vitest';
import type { SelfRepresentation, LayerDiagnostic, ModuleInfo, ModificationRecord } from '@primo-ai/sdk';
import { SelfRepresentationBuilder } from '../src/self-representation.js';

// Minimal agent-like object for builder inputs
function makeMockAgent(overrides?: Record<string, unknown>) {
  return {
    orchestrator: {
      stageConfig: {
        preLoop: ['processInput', 'buildContext'],
        loop: ['prepareStep', 'gateLLM', 'invokeLLM', 'processStepOutput', 'gateTool', 'executeTools', 'evaluateIteration'],
        postLoop: ['processOutput'],
      },
    },
    toolRegistry: {
      getAll: () => [{ name: 'echo' }, { name: 'inspectSelf' }, { name: 'replaceProcessor' }],
      list: () => ['echo', 'inspectSelf', 'replaceProcessor'],
    },
    pluginManager: {
      loadedPlugins: ['memory', 'compression', 'permission'],
    },
    getPluginNames: () => ['memory', 'compression', 'permission'],
    state: 'completed',
    config: { model: 'test-model' },
    eventBus: {
      query: () => [],
    },
    ...overrides,
  };
}

describe('SelfRepresentationBuilder', () => {
  it('builds modules from agent runtime state', () => {
    const agent = makeMockAgent();
    const builder = new SelfRepresentationBuilder({ agent: agent as any });
    const rep = builder.build();

    expect(rep.modules.length).toBeGreaterThan(0);

    const processorModules = rep.modules.filter(m => m.responsibility === 'processor');
    expect(processorModules.length).toBeGreaterThan(0);
  });

  it('builds dependencies from pipeline config', () => {
    const agent = makeMockAgent();
    const builder = new SelfRepresentationBuilder({ agent: agent as any });
    const rep = builder.build();

    expect(rep.dependencies.length).toBeGreaterThan(0);

    const usesDeps = rep.dependencies.filter(d => d.type === 'uses');
    expect(usesDeps.length).toBeGreaterThan(0);
  });

  it('builds ECC 12-layer diagnostics', () => {
    const agent = makeMockAgent();
    const builder = new SelfRepresentationBuilder({ agent: agent as any });
    const rep = builder.build();

    expect(rep.layerDiagnostics.length).toBe(12);

    const layer1 = rep.layerDiagnostics.find(l => l.layer === 1);
    expect(layer1?.name).toBe('System prompt');
    expect(layer1?.agentForgeComponent).toBe('config.systemPrompt');

    const layer6 = rep.layerDiagnostics.find(l => l.layer === 6);
    expect(layer6?.name).toBe('Tool selection');
    expect(layer6?.codeGated).toBe(true);
  });

  it('includes modification history from event store', () => {
    const events = [
      { type: 'mutation', payload: { timestamp: '2026-05-25T10:00:00Z', module: 'invokeLLM', type: 'processor', diff: 'changed', verificationResult: 'passed', approvedBy: 'auto' } },
    ];
    const agent = makeMockAgent({
      eventBus: { query: () => events },
    });
    const builder = new SelfRepresentationBuilder({ agent: agent as any });
    const rep = builder.build();

    expect(rep.modificationHistory.length).toBe(1);
    expect(rep.modificationHistory[0].module).toBe('invokeLLM');
    expect(rep.modificationHistory[0].approvedBy).toBe('auto');
  });

  it('returns empty modification history when no events', () => {
    const agent = makeMockAgent();
    const builder = new SelfRepresentationBuilder({ agent: agent as any });
    const rep = builder.build();

    expect(rep.modificationHistory).toEqual([]);
  });

  it('sets constitution to null when not provided', () => {
    const agent = makeMockAgent();
    const builder = new SelfRepresentationBuilder({ agent: agent as any });
    const rep = builder.build();

    expect(rep.constitution).toBeNull();
  });

  it('includes constitution when provided', () => {
    const agent = makeMockAgent();
    const constitution = { version: 1, protectedPaths: [] };
    const builder = new SelfRepresentationBuilder({ agent: agent as any, constitution });
    const rep = builder.build();

    expect(rep.constitution).toEqual(constitution);
  });

  it('marks pipeline stages as modules with correct mutability', () => {
    const agent = makeMockAgent();
    const mutabilityPolicy = { pipeline: 'configOnly' as const, processors: 'frozen' as const, plugins: 'dynamic' as const, tools: 'dynamic' as const, hotReload: true, watchConfig: false };
    const builder = new SelfRepresentationBuilder({ agent: agent as any, mutabilityPolicy });
    const rep = builder.build();

    const processorModules = rep.modules.filter(m => m.responsibility === 'processor');
    for (const mod of processorModules) {
      expect(mod.mutability).toBe('frozen');
    }
  });

  it('assigns risk levels to layers based on codeGated', () => {
    const agent = makeMockAgent();
    const builder = new SelfRepresentationBuilder({ agent: agent as any });
    const rep = builder.build();

    for (const diag of rep.layerDiagnostics) {
      if (diag.codeGated) {
        expect(['medium', 'high', 'critical']).toContain(diag.riskLevel);
      } else {
        expect(['low', 'medium']).toContain(diag.riskLevel);
      }
    }
  });

  it('dynamically rebuilds on each build() call', () => {
    const agent = makeMockAgent();
    const builder = new SelfRepresentationBuilder({ agent: agent as any });

    const rep1 = builder.build();

    (agent as any).toolRegistry.getAll = () => [{ name: 'echo' }, { name: 'newTool' }];

    const rep2 = builder.build();

    const tools1 = rep1.modules.filter(m => m.responsibility === 'tool').map(m => m.name);
    const tools2 = rep2.modules.filter(m => m.responsibility === 'tool').map(m => m.name);
    expect(tools1).not.toEqual(tools2);
  });
});
