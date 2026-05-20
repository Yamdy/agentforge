import { describe, it, expect } from 'vitest';
import {
  executorPreset,
  plannerPreset,
  researcherPreset,
  builtInPresets,
  registerPreset,
  getPreset,
  listPresets,
  createConfigFromPreset,
  presetToPermissionConfig,
  type AgentPreset,
} from '../src/presets/index.js';

describe('Agent Presets', () => {
  describe('Built-in Presets', () => {
    it('should have executor preset with correct properties', () => {
      expect(executorPreset).toBeDefined();
      expect(executorPreset.id).toBe('executor');
      expect(executorPreset.name).toBe('Executor');
      expect(executorPreset.mode).toBe('primary');
      expect(executorPreset.permissionMode).toBe('interactive');
      expect(executorPreset.systemPromptFragment).toBeDefined();
      expect(executorPreset.permissions).toBeInstanceOf(Array);
      expect(executorPreset.permissions.length).toBeGreaterThan(0);
      expect(executorPreset.defaultModel).toBeDefined();
    });

    it('should have planner preset with correct properties', () => {
      expect(plannerPreset).toBeDefined();
      expect(plannerPreset.id).toBe('planner');
      expect(plannerPreset.name).toBe('Planner');
      expect(plannerPreset.mode).toBe('primary');
      expect(plannerPreset.permissionMode).toBe('plan-only');
      expect(plannerPreset.systemPromptFragment).toBeDefined();
      expect(plannerPreset.defaultModel).toBeDefined();
      // Planner should have read-only permissions
      const hasWritePermission = plannerPreset.permissions.some(
        (p) => p.tool === 'file_write' && p.action === 'allow'
      );
      expect(hasWritePermission).toBe(false);
    });

    it('should have researcher preset with correct properties', () => {
      expect(researcherPreset).toBeDefined();
      expect(researcherPreset.id).toBe('researcher');
      expect(researcherPreset.name).toBe('Researcher');
      expect(researcherPreset.mode).toBe('subagent');
      expect(researcherPreset.permissionMode).toBe('full-auto');
      expect(researcherPreset.systemPromptFragment).toBeDefined();
      expect(researcherPreset.defaultModel).toBeDefined();
    });

    it('builtInPresets should contain all three presets', () => {
      expect(builtInPresets).toHaveLength(3);
      expect(builtInPresets.map((p) => p.id)).toContain('executor');
      expect(builtInPresets.map((p) => p.id)).toContain('planner');
      expect(builtInPresets.map((p) => p.id)).toContain('researcher');
    });
  });

  describe('Preset Registry', () => {
    it('should get preset by id', () => {
      const preset = getPreset('executor');
      expect(preset).toBeDefined();
      expect(preset?.id).toBe('executor');
    });

    it('should return undefined for unknown preset', () => {
      const preset = getPreset('unknown');
      expect(preset).toBeUndefined();
    });

    it('should list all presets', () => {
      const presets = listPresets();
      expect(presets.length).toBeGreaterThanOrEqual(3);
    });

    it('should register custom preset', () => {
      const customPreset: AgentPreset = {
        id: 'custom',
        name: 'Custom Agent',
        description: 'A custom agent for testing',
        mode: 'primary',
        permissionMode: 'interactive',
        permissions: [{ tool: '*', action: 'allow' }],
      };

      registerPreset(customPreset);

      const retrieved = getPreset('custom');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Custom Agent');
    });
  });

  describe('createConfigFromPreset', () => {
    it('should create config from preset id', () => {
      const config = createConfigFromPreset('executor');
      expect(config).toBeDefined();
      expect(config.model).toBe('claude-sonnet-4-6');
      expect(config.systemPrompt).toBeDefined();
      expect(config.maxIterations).toBe(10);
    });

    it('should allow overriding model', () => {
      const config = createConfigFromPreset('executor', {
        model: 'claude-sonnet-4-6',
      });
      expect(config.model).toBe('claude-sonnet-4-6');
    });

    it('should allow overriding systemPrompt', () => {
      const customPrompt = 'Custom system prompt';
      const config = createConfigFromPreset('executor', {
        systemPrompt: customPrompt,
      });
      expect(config.systemPrompt).toBe(customPrompt);
    });

    it('should throw for unknown preset', () => {
      expect(() => createConfigFromPreset('unknown')).toThrow('Unknown preset: unknown');
    });

    it('should throw when no model available', () => {
      // Register a preset without defaultModel
      const noModelPreset: AgentPreset = {
        id: 'no-model',
        name: 'No Model',
        description: 'Preset without default model',
        mode: 'primary',
        permissionMode: 'interactive',
        permissions: [{ tool: '*', action: 'allow' }],
      };
      registerPreset(noModelPreset);

      expect(() => createConfigFromPreset('no-model')).toThrow(
        "No model specified. Provide model in overrides or set defaultModel on preset 'no-model'."
      );
    });
  });

  describe('presetToPermissionConfig', () => {
    it('should convert preset to permission config', () => {
      const permConfig = presetToPermissionConfig(executorPreset);
      expect(permConfig).toBeDefined();
      expect(permConfig.mode).toBe('interactive');
      expect(permConfig.rules).toBeInstanceOf(Array);
      expect(permConfig.rules.length).toBeGreaterThan(0);
    });

    it('should preserve permission rules', () => {
      const permConfig = presetToPermissionConfig(plannerPreset);
      expect(permConfig.mode).toBe('plan-only');
      // Check that read permissions are allowed
      const readPerms = permConfig.rules.filter((r) => r.action === 'allow');
      expect(readPerms.length).toBeGreaterThan(0);
    });
  });
});
