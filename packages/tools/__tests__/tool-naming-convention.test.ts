import { describe, it, expect } from 'vitest';
import { builtinTools, toolsByCategory } from '../src/index.js';

/**
 * TDD RED: 测试所有内置工具名称统一遵循 snake_case 命名规范
 *
 * 用户旅程：
 * 作为 Agent 框架开发者，我希望所有内置工具名称统一使用 snake_case 规范，
 * 以便 LLM 能够以一致的模式选择和调用工具，提高工具选择准确率。
 *
 * snake_case 规则：
 * - 仅包含小写字母、数字和下划线
 * - 多词之间用下划线连接
 * - 不含大写字母或 camelCase
 */
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

describe('tool naming convention', () => {
  const expectedNames: Record<string, string> = {
    file_read: 'file read tool',
    file_write: 'file write tool',
    file_edit: 'file edit tool',
    echo: 'echo tool',
    http: 'http tool',
    glob: 'glob tool',
    grep: 'grep tool',
    shell: 'shell tool',
    calculator: 'calculator tool',
    datetime: 'datetime tool',
    json: 'json tool',
    web_search: 'web search tool',
    web_fetch: 'web fetch tool',
    memory_store: 'memory store tool',
    memory_retrieve: 'memory retrieve tool',
    memory_list: 'memory list tool',
  };

  it('all builtin tools follow snake_case naming convention', () => {
    const violations: string[] = [];
    for (const tool of builtinTools) {
      if (!SNAKE_CASE_RE.test(tool.name)) {
        violations.push(tool.name);
      }
    }
    expect(violations).toEqual([]);
  });

  it('all builtin tools have expected snake_case names', () => {
    const names = builtinTools.map((t) => t.name).sort();
    const expected = Object.keys(expectedNames).sort();
    expect(names).toEqual(expected);
  });

  it('no tool uses camelCase naming', () => {
    const camelCaseTools = builtinTools.filter((t) => /[a-z][A-Z]/.test(t.name));
    expect(camelCaseTools.map((t) => t.name)).toEqual([]);
  });

  it('file tools use snake_case (file_read, file_write, file_edit)', () => {
    const fileToolNames = toolsByCategory.file.map((t) => t.name);
    expect(fileToolNames).toContain('file_read');
    expect(fileToolNames).toContain('file_write');
    expect(fileToolNames).toContain('file_edit');
  });
});
