import { describe, it, expect, beforeEach } from 'vitest';
import {
  PermissionManager,
  matchPattern,
  defaultRules,
  strictRules,
  permissiveRules,
  readOnlyRules,
  presets,
  parsePermissionConfig,
} from '../../src/permission/index.js';
import type { Ruleset, PermissionCheckResult, PermissionManagerConfig } from '../../src/permission/types.js';

// ========== Pattern Matching Tests ==========

describe('matchPattern', () => {
  it('should match exact strings', () => {
    expect(matchPattern('hello', 'hello')).toBe(true);
    expect(matchPattern('hello', 'world')).toBe(false);
  });

  it('should match wildcard * (zero or more chars)', () => {
    expect(matchPattern('*', 'anything')).toBe(true);
    expect(matchPattern('*', '')).toBe(true);
    expect(matchPattern('git *', 'git status')).toBe(true);
    expect(matchPattern('git *', 'git commit -m "test"')).toBe(true);
    expect(matchPattern('git *', 'npm install')).toBe(false);
  });

  it('should match wildcard ? (exactly one char)', () => {
    expect(matchPattern('file?.ts', 'file1.ts')).toBe(true);
    expect(matchPattern('file?.ts', 'fileA.ts')).toBe(true);
    expect(matchPattern('file?.ts', 'file.ts')).toBe(false);
    expect(matchPattern('file?.ts', 'file12.ts')).toBe(false);
  });

  it('should match file path patterns', () => {
    expect(matchPattern('*.env', 'config.env')).toBe(true);
    // *.env also matches .env because * matches zero or more chars
    expect(matchPattern('*.env', '.env')).toBe(true);
    expect(matchPattern('*.env.*', 'config.env.local')).toBe(true);
    expect(matchPattern('*.env.example', 'config.env.example')).toBe(true);
    expect(matchPattern('src/**/*.ts', 'src/utils/helper.ts')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(matchPattern('git *', 'Git Status')).toBe(true);
    expect(matchPattern('READ', 'read')).toBe(true);
  });

  it('should escape special regex characters', () => {
    expect(matchPattern('file.txt', 'file.txt')).toBe(true);
    expect(matchPattern('file.txt', 'fileXtxt')).toBe(false);
    expect(matchPattern('cmd(a)', 'cmd(a)')).toBe(true);
  });
});

// ========== PermissionManager Tests ==========

describe('PermissionManager', () => {
  let manager: PermissionManager;

  beforeEach(() => {
    manager = new PermissionManager();
  });

  describe('basic check', () => {
    it('should default to ask when no config provided', () => {
      const result = manager.check('session-1', 'bash', 'git status');
      expect(result.action).toBe('ask');
      expect(result.askPrompt).toBeDefined();
    });

    it('should use defaultAction=allow for backward compatibility', () => {
      const managerAllow = new PermissionManager({ defaultAction: 'allow' });
      const result = managerAllow.check('session-1', 'bash', 'git status');
      expect(result.action).toBe('allow');
    });

    it('should check against global rules', () => {
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
      ]);
      const result = manager.check('session-1', 'bash', 'git status');
      expect(result.action).toBe('ask');
    });

    it('should apply last-match-wins', () => {
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
        { permission: 'bash', action: 'allow', pattern: 'git *' },
      ]);
      // "git status" matches both, but "git *" is last → allow
      const result = manager.check('session-1', 'bash', 'git status');
      expect(result.action).toBe('allow');
    });

    it('should deny when rule says deny', () => {
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
        { permission: 'bash', action: 'deny', pattern: 'rm *' },
      ]);
      const result = manager.check('session-1', 'bash', 'rm -rf /');
      expect(result.action).toBe('deny');
    });

    it('should match wildcard category *', () => {
      manager.setRules([
        { permission: '*', action: 'ask', pattern: '*' },
        { permission: 'read', action: 'allow', pattern: '*' },
      ]);
      expect(manager.check('s1', 'read', 'any').action).toBe('allow');
      expect(manager.check('s1', 'bash', 'any').action).toBe('ask');
    });
  });

  describe('per-agent rules', () => {
    it('should merge global and agent rules', () => {
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
      ]);
      manager.setAgentRules('build-agent', [
        { permission: 'bash', action: 'allow', pattern: 'npm *' },
      ]);

      // Global: bash * = ask
      expect(manager.check('s1', 'bash', 'git status').action).toBe('ask');

      // Agent: bash npm * = allow (agent rules come after global, last match wins)
      expect(manager.check('s1', 'bash', 'npm run build', 'build-agent').action).toBe('allow');
    });

    it('should allow agent to deny what global allows', () => {
      manager.setRules([
        { permission: 'bash', action: 'allow', pattern: '*' },
      ]);
      manager.setAgentRules('review-agent', [
        { permission: 'bash', action: 'deny', pattern: '*' },
      ]);

      expect(manager.check('s1', 'bash', 'any').action).toBe('allow');
      expect(manager.check('s1', 'bash', 'any', 'review-agent').action).toBe('deny');
    });
  });

  describe('session always-allowed', () => {
    it('should bypass check for always-allowed rules', () => {
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
      ]);
      manager.setAlwaysAllowed('session-1', 'bash', 'git *');

      const result = manager.check('session-1', 'bash', 'git status');
      expect(result.action).toBe('allow');
      expect(result.matchedPattern).toBe('git *');
    });

    it('should not affect other sessions', () => {
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
      ]);
      manager.setAlwaysAllowed('session-1', 'bash', 'git *');

      expect(manager.check('session-1', 'bash', 'git status').action).toBe('allow');
      expect(manager.check('session-2', 'bash', 'git status').action).toBe('ask');
    });

    it('should clear always-allowed for a session', () => {
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
      ]);
      manager.setAlwaysAllowed('session-1', 'bash', 'git *');
      manager.clearSessionAlwaysAllowed('session-1');

      expect(manager.check('session-1', 'bash', 'git status').action).toBe('ask');
    });

    it('should check isAlwaysAllowed', () => {
      manager.setAlwaysAllowed('s1', 'bash', 'git *');
      expect(manager.isAlwaysAllowed('s1', 'bash', 'git status')).toBe(true);
      expect(manager.isAlwaysAllowed('s1', 'bash', 'npm install')).toBe(false);
      expect(manager.isAlwaysAllowed('s2', 'bash', 'git status')).toBe(false);
    });
  });

  describe('ask prompt', () => {
    it('should include askPrompt when action is ask', () => {
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
      ]);
      const result = manager.check('s1', 'bash', 'git status');
      expect(result.action).toBe('ask');
      expect(result.askPrompt).toBeDefined();
      expect(result.askPrompt?.message).toContain('bash');
      expect(result.askPrompt?.choices).toContain('Allow once');
      expect(result.askPrompt?.choices).toContain('Always allow');
      expect(result.askPrompt?.choices).toContain('Deny');
    });
  });

  describe('permission requests', () => {
    it('should create and resolve permission requests', () => {
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
      ]);
      const request = manager.createRequest('s1', 'bash', 'git status');
      expect(request.sessionId).toBe('s1');
      expect(request.permission).toBe('bash');
      expect(request.input).toBe('git status');
      expect(request.suggestedPatterns.length).toBeGreaterThan(0);

      // Resolve with always allow
      manager.resolveRequest({
        requestId: request.id,
        decision: 'allow',
        always: true,
      });

      // Should now be always allowed
      expect(manager.isAlwaysAllowed('s1', 'bash', 'git status')).toBe(true);
    });
  });
});

// ========== Presets Tests ==========

describe('Permission Presets', () => {
  it('should have default preset with read=allow, bash=ask, edit=ask', () => {
    const manager = new PermissionManager();
    manager.setRules(defaultRules);

    expect(manager.check('s1', 'read', 'any-file').action).toBe('allow');
    expect(manager.check('s1', 'bash', 'any-command').action).toBe('ask');
    expect(manager.check('s1', 'edit', 'any-file').action).toBe('ask');
  });

  it('should deny .env files in default preset', () => {
    const manager = new PermissionManager();
    manager.setRules(defaultRules);

    expect(manager.check('s1', 'read', 'config.env').action).toBe('deny');
    expect(manager.check('s1', 'read', 'config.env.local').action).toBe('deny');
    expect(manager.check('s1', 'read', 'config.env.example').action).toBe('allow');
  });

  it('should have strict preset with mostly ask', () => {
    const manager = new PermissionManager();
    manager.setRules(strictRules);

    expect(manager.check('s1', 'read', 'any-file').action).toBe('allow');
    expect(manager.check('s1', 'bash', 'any-command').action).toBe('ask');
    expect(manager.check('s1', 'edit', 'any-file').action).toBe('ask');
  });

  it('should have permissive preset with mostly allow', () => {
    const manager = new PermissionManager();
    manager.setRules(permissiveRules);

    expect(manager.check('s1', 'bash', 'any-command').action).toBe('allow');
    expect(manager.check('s1', 'edit', 'any-file').action).toBe('allow');
    // .env still denied
    expect(manager.check('s1', 'read', 'config.env').action).toBe('deny');
  });

  it('should have read-only preset denying writes', () => {
    const manager = new PermissionManager();
    manager.setRules(readOnlyRules);

    expect(manager.check('s1', 'read', 'any-file').action).toBe('allow');
    expect(manager.check('s1', 'edit', 'any-file').action).toBe('deny');
    expect(manager.check('s1', 'bash', 'any-command').action).toBe('deny');
  });

  it('should have all presets in presets map', () => {
    expect(presets['default']).toBe(defaultRules);
    expect(presets['strict']).toBe(strictRules);
    expect(presets['permissive']).toBe(permissiveRules);
    expect(presets['read-only']).toBe(readOnlyRules);
  });
});

// ========== parsePermissionConfig Tests ==========

describe('parsePermissionConfig', () => {
  it('should parse simple format', () => {
    const config = { bash: 'ask' as const };
    const rules = parsePermissionConfig(config);
    expect(rules).toEqual([
      { permission: 'bash', action: 'ask', pattern: '*' },
    ]);
  });

  it('should parse granular format', () => {
    const config = {
      bash: { '*': 'ask' as const, 'git *': 'allow' as const },
    };
    const rules = parsePermissionConfig(config);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ permission: 'bash', action: 'ask', pattern: '*' });
    expect(rules[1]).toEqual({ permission: 'bash', action: 'allow', pattern: 'git *' });
  });

  it('should parse mixed format', () => {
    const config = {
      bash: { '*': 'ask' as const, 'git *': 'allow' as const },
      edit: 'deny' as const,
      read: 'allow' as const,
    };
    const rules = parsePermissionConfig(config);
    expect(rules).toHaveLength(4);
  });
});

// ========== Integration: ToolRegistry + PermissionManager ==========

describe('PermissionManager + ToolRegistry integration', () => {
  it('should integrate with ToolRegistry', async () => {
    const { ToolRegistry } = await import('../../src/registry.js');
    const registry = new ToolRegistry();
    const manager = new PermissionManager();
    manager.setRules(defaultRules);
    registry.setPermissionManager(manager);

    // Verify permission manager is set
    expect(registry.permissionManager).toBe(manager);
  });
});

// ========== Security Defaults Tests ==========

describe('PermissionManager Security Defaults', () => {
  describe('constructor and default action', () => {
    it('should default to ask when no config provided', () => {
      const manager = new PermissionManager();
      expect(manager.getDefaultAction()).toBe('ask');
    });

    it('should use defaultAction=allow for backward compatibility', () => {
      const manager = new PermissionManager({ defaultAction: 'allow' });
      expect(manager.getDefaultAction()).toBe('allow');
    });

    it('should use defaultAction=deny when configured', () => {
      const manager = new PermissionManager({ defaultAction: 'deny' });
      expect(manager.getDefaultAction()).toBe('deny');
    });

    it('should return deny when no rules match and defaultAction=deny', () => {
      const manager = new PermissionManager({ defaultAction: 'deny' });
      const result = manager.check('s1', 'bash', 'git status');
      expect(result.action).toBe('deny');
    });

    it('should return ask with prompt when no rules match and defaultAction=ask', () => {
      const manager = new PermissionManager({ defaultAction: 'ask' });
      const result = manager.check('s1', 'bash', 'git status');
      expect(result.action).toBe('ask');
      expect(result.askPrompt).toBeDefined();
      expect(result.askPrompt?.message).toContain('no matching rule');
      expect(result.askPrompt?.defaultChoice).toBe('Deny');
    });
  });

  describe('strict mode', () => {
    it('should set defaultAction=deny in strict mode', () => {
      const manager = new PermissionManager({ strict: true });
      expect(manager.getDefaultAction()).toBe('deny');
    });

    it('should load strictRules in strict mode', () => {
      const manager = new PermissionManager({ strict: true });
      // read is allowed in strictRules (last match wins)
      expect(manager.check('s1', 'read', 'any').action).toBe('allow');
      // bash is ask in strictRules
      expect(manager.check('s1', 'bash', 'git status').action).toBe('ask');
      // unknown matches the wildcard rule '*' which is 'ask' in strictRules
      expect(manager.check('s1', 'unknown', 'any').action).toBe('ask');
    });

    it('should allow custom rules to override strict defaults', () => {
      const manager = new PermissionManager({ strict: true });
      manager.setRules([
        { permission: 'custom', action: 'allow', pattern: '*' },
      ]);
      expect(manager.check('s1', 'custom', 'any').action).toBe('allow');
      expect(manager.check('s1', 'unknown', 'any').action).toBe('deny');
    });

    it('strict should override defaultAction config', () => {
      const manager = new PermissionManager({
        strict: true,
        defaultAction: 'allow',
      });
      expect(manager.getDefaultAction()).toBe('deny');
      // unknown matches the wildcard rule '*' which is 'ask' in strictRules
      // (not the defaultAction, because a rule matched)
      expect(manager.check('s1', 'unknown', 'any').action).toBe('ask');
    });
  });

  describe('integration with existing features', () => {
    it('should still respect sessionAlwaysAllowed over defaultAction', () => {
      const manager = new PermissionManager({ defaultAction: 'deny' });
      manager.setAlwaysAllowed('s1', 'bash', 'git *');
      expect(manager.check('s1', 'bash', 'git status').action).toBe('allow');
    });

    it('should still respect matched rules over defaultAction', () => {
      const manager = new PermissionManager({ defaultAction: 'deny' });
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
      ]);
      expect(manager.check('s1', 'bash', 'any').action).toBe('ask');
    });

    it('should work with defaultRules and ask default', () => {
      const manager = new PermissionManager({ defaultAction: 'ask' });
      manager.setRules(defaultRules);
      // defaultRules covers bash with 'ask'
      expect(manager.check('s1', 'bash', 'git status').action).toBe('ask');
      // unknown category uses defaultAction
      expect(manager.check('s1', 'unknown', 'any').action).toBe('ask');
    });
  });
});
