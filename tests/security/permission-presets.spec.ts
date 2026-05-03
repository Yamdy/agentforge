/**
 * Permission Presets Tests
 *
 * Tests for the 6 named PermissionPolicy presets and helper functions.
 */

import { describe, it, expect } from 'vitest';
import {
  PERMISSION_PRESETS,
  getPermissionPreset,
  listPermissionPresets,
} from '../../src/security/permission/presets.js';
import type { PermissionPolicy } from '../../src/security/permission/permission-policy.js';
import { evaluatePermission } from '../../src/security/permission/permission-policy.js';
import type { ToolDefinition } from '../../src/core/interfaces.js';

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: {},
    execute: async () => 'ok',
    ...overrides,
  };
}

function isValidPolicy(policy: PermissionPolicy): boolean {
  const riskLevels = ['low', 'medium', 'high', 'critical'] as const;
  const decisions = ['allow', 'ask', 'deny'] as const;

  // Check riskPolicies has all risk levels with valid decisions
  for (const level of riskLevels) {
    const d = (policy.riskPolicies as Record<string, string>)[level];
    if (!d || !(decisions as readonly string[]).includes(d)) return false;
  }

  // Check defaultPolicy is valid
  if (!(decisions as readonly string[]).includes(policy.defaultPolicy)) return false;

  // Check enforceApprovalFlag is boolean
  if (typeof policy.enforceApprovalFlag !== 'boolean') return false;

  // Check toolPolicies values are all valid
  for (const d of Object.values(policy.toolPolicies)) {
    if (!(decisions as readonly string[]).includes(d)) return false;
  }

  return true;
}

// ============================================================
// Preset Validity Tests
// ============================================================

describe('Permission Presets', () => {
  describe('validity', () => {
    const presetNames = ['default', 'plan', 'acceptEdits', 'bypass', 'strict', 'dontAsk'] as const;

    for (const name of presetNames) {
      it(`"${name}" preset is a valid PermissionPolicy`, () => {
        const preset = PERMISSION_PRESETS[name];
        expect(isValidPolicy(preset)).toBe(true);
      });

      it(`"${name}" preset has enforceApprovalFlag as boolean`, () => {
        const preset = PERMISSION_PRESETS[name];
        expect(typeof preset.enforceApprovalFlag).toBe('boolean');
      });
    }

    it('all presets have required riskPolicies keys', () => {
      const requiredKeys = ['low', 'medium', 'high', 'critical'];
      for (const name of presetNames) {
        const preset = PERMISSION_PRESETS[name];
        for (const key of requiredKeys) {
          expect(preset.riskPolicies).toHaveProperty(key);
        }
      }
    });
  });

  // ============================================================
  // Individual Preset Behavior Tests
  // ============================================================

  describe('default preset', () => {
    const policy = PERMISSION_PRESETS.default;

    it('allows low risk tools', () => {
      const tool = makeTool({ name: 'read_file', riskLevel: 'low' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('allows medium risk tools', () => {
      const tool = makeTool({ name: 'some_tool', riskLevel: 'medium' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('asks for high risk tools', () => {
      const tool = makeTool({ name: 'bash', riskLevel: 'high' });
      expect(evaluatePermission(tool, policy)).toBe('ask');
    });

    it('asks for critical risk tools', () => {
      const tool = makeTool({ name: 'root_command', riskLevel: 'critical' });
      expect(evaluatePermission(tool, policy)).toBe('ask');
    });

    it('has enforceApprovalFlag enabled', () => {
      expect(policy.enforceApprovalFlag).toBe(true);
    });

    it('enforces requiresApproval flag as ask', () => {
      const tool = makeTool({ name: 'safe_tool', riskLevel: 'low', requiresApproval: true });
      expect(evaluatePermission(tool, policy)).toBe('ask');
    });
  });

  describe('plan preset', () => {
    const policy = PERMISSION_PRESETS.plan;

    it('allows low risk (read) tools', () => {
      const tool = makeTool({ name: 'read_file', riskLevel: 'low' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('denies medium risk tools that are not in toolPolicies', () => {
      const tool = makeTool({ name: 'write_file', riskLevel: 'medium' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('denies high risk tools', () => {
      const tool = makeTool({ name: 'bash', riskLevel: 'high' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('denies critical risk tools', () => {
      const tool = makeTool({ name: 'rm_rf', riskLevel: 'critical' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('allows read_file via toolPolicies', () => {
      const tool = makeTool({ name: 'read_file', riskLevel: 'medium' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('allows glob via toolPolicies', () => {
      const tool = makeTool({ name: 'glob', riskLevel: 'medium' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('allows grep via toolPolicies', () => {
      const tool = makeTool({ name: 'grep', riskLevel: 'medium' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });
  });

  describe('acceptEdits preset', () => {
    const policy = PERMISSION_PRESETS.acceptEdits;

    it('auto-approves write_file via toolPolicies', () => {
      const tool = makeTool({ name: 'write_file', riskLevel: 'high' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('auto-approves edit_file via toolPolicies', () => {
      const tool = makeTool({ name: 'edit_file', riskLevel: 'high' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('still asks for bash (not in toolPolicies)', () => {
      const tool = makeTool({ name: 'bash', riskLevel: 'high' });
      expect(evaluatePermission(tool, policy)).toBe('ask');
    });

    it('still asks for critical risk tools', () => {
      const tool = makeTool({ name: 'dangerous_op', riskLevel: 'critical' });
      expect(evaluatePermission(tool, policy)).toBe('ask');
    });
  });

  describe('bypass preset', () => {
    const policy = PERMISSION_PRESETS.bypass;

    it('allows any tool regardless of risk level', () => {
      const levels = ['low', 'medium', 'high', 'critical'] as const;
      for (const level of levels) {
        const tool = makeTool({ name: `tool_${level}`, riskLevel: level });
        expect(evaluatePermission(tool, policy)).toBe('allow');
      }
    });

    it('has enforceApprovalFlag disabled', () => {
      expect(policy.enforceApprovalFlag).toBe(false);
    });

    it('default policy is allow', () => {
      expect(policy.defaultPolicy).toBe('allow');
    });

    it('all risk policies are allow', () => {
      expect(policy.riskPolicies.low).toBe('allow');
      expect(policy.riskPolicies.medium).toBe('allow');
      expect(policy.riskPolicies.high).toBe('allow');
      expect(policy.riskPolicies.critical).toBe('allow');
    });
  });

  describe('strict preset', () => {
    const policy = PERMISSION_PRESETS.strict;

    it('denies everything by default', () => {
      const tool = makeTool({ name: 'unknown_tool', riskLevel: 'low' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('denies low risk tools', () => {
      const tool = makeTool({ name: 'read_file', riskLevel: 'low' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('denies medium risk tools', () => {
      const tool = makeTool({ name: 'some_tool', riskLevel: 'medium' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('denies high risk tools', () => {
      const tool = makeTool({ name: 'bash', riskLevel: 'high' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('denies critical risk tools', () => {
      const tool = makeTool({ name: 'rm_rf', riskLevel: 'critical' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('defaultPolicy is deny', () => {
      expect(policy.defaultPolicy).toBe('deny');
    });

    it('enforceApprovalFlag is true', () => {
      expect(policy.enforceApprovalFlag).toBe(true);
    });
  });

  describe('dontAsk preset', () => {
    const policy = PERMISSION_PRESETS.dontAsk;

    it('allows low risk', () => {
      const tool = makeTool({ name: 'read_file', riskLevel: 'low' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('allows medium risk', () => {
      const tool = makeTool({ name: 'some_tool', riskLevel: 'medium' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('denies high risk instead of asking', () => {
      const tool = makeTool({ name: 'bash', riskLevel: 'high' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('denies critical risk instead of asking', () => {
      const tool = makeTool({ name: 'rm_rf', riskLevel: 'critical' });
      expect(evaluatePermission(tool, policy)).toBe('deny');
    });

    it('defaultPolicy is deny', () => {
      expect(policy.defaultPolicy).toBe('deny');
    });

    it('enforceApprovalFlag is true', () => {
      expect(policy.enforceApprovalFlag).toBe(true);
    });
  });

  // ============================================================
  // Helper Functions
  // ============================================================

  describe('getPermissionPreset', () => {
    it('returns the correct preset for valid names', () => {
      expect(getPermissionPreset('default')).toBe(PERMISSION_PRESETS.default);
      expect(getPermissionPreset('plan')).toBe(PERMISSION_PRESETS.plan);
      expect(getPermissionPreset('bypass')).toBe(PERMISSION_PRESETS.bypass);
    });

    it('throws for unknown preset name', () => {
      expect(() => getPermissionPreset('nonexistent')).toThrow();
    });

    it('throws for empty string', () => {
      expect(() => getPermissionPreset('')).toThrow();
    });
  });

  describe('listPermissionPresets', () => {
    it('returns all 6 preset names', () => {
      const names = listPermissionPresets();
      expect(names).toHaveLength(6);
      expect(names).toContain('default');
      expect(names).toContain('plan');
      expect(names).toContain('acceptEdits');
      expect(names).toContain('bypass');
      expect(names).toContain('strict');
      expect(names).toContain('dontAsk');
    });

    it('returns strings only', () => {
      const names = listPermissionPresets();
      for (const name of names) {
        expect(typeof name).toBe('string');
      }
    });
  });

  // ============================================================
  // Integration: evaluatePermission with presets
  // ============================================================

  describe('evaluatePermission integration', () => {
    it('toolPolicies override riskPolicies in plan preset', () => {
      const policy = PERMISSION_PRESETS.plan;
      // read_file is 'low' risk → riskPolicies would deny medium, but toolPolicies override
      const tool = makeTool({ name: 'read_file', riskLevel: 'medium' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });

    it('toolPolicies override riskPolicies in acceptEdits preset', () => {
      const policy = PERMISSION_PRESETS.acceptEdits;
      // write_file even if risk is critical, toolPolicies allow it
      const tool = makeTool({ name: 'write_file', riskLevel: 'critical' });
      expect(evaluatePermission(tool, policy)).toBe('allow');
    });
  });
});
