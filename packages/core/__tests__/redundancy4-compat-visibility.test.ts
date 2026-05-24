import { describe, it, expect } from 'vitest';
import { BUILTIN_COMPAT_RULES } from '../src/processors/provider-history-compat.js';
import type { CompatRule, HarnessConfig } from '@primo-ai/sdk';

describe('冗余4: CompatRule 可见性', () => {
  it('BUILTIN_COMPAT_RULES 应可导出以便外部查询', () => {
    expect(BUILTIN_COMPAT_RULES).toBeDefined();
    expect(BUILTIN_COMPAT_RULES.length).toBeGreaterThan(0);
    for (const rule of BUILTIN_COMPAT_RULES) {
      expect(rule.name).toBeTruthy();
    }
  });

  it('HarnessConfig 应包含 compatRules 可选字段', () => {
    const config: HarnessConfig = {
      compatRules: BUILTIN_COMPAT_RULES,
    };
    expect(config.compatRules).toBeDefined();
    expect(config.compatRules!.length).toBeGreaterThan(0);
  });

  it('HarnessConfig 的 compatRules 默认为 undefined（使用内置规则）', () => {
    const config: HarnessConfig = {};
    expect(config.compatRules).toBeUndefined();
  });
});
