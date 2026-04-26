import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  toPascalCase,
  toCamelCase,
  toKebabCase,
  renderTemplate,
  createTempDir,
  cleanupTempDir,
  writeFile,
} from '../utils.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('String case converters', () => {
  describe('toPascalCase', () => {
    it('converts hyphenated string to PascalCase', () => {
      expect(toPascalCase('my-agent')).toBe('MyAgent');
    });

    it('converts underscore string to PascalCase', () => {
      expect(toPascalCase('my_agent')).toBe('MyAgent');
    });

    it('converts single word to PascalCase', () => {
      expect(toPascalCase('agent')).toBe('Agent');
    });

    it('handles mixed separators', () => {
      expect(toPascalCase('my_agent-name')).toBe('MyAgentName');
    });

    it('handles empty string', () => {
      expect(toPascalCase('')).toBe('');
    });
  });

  describe('toCamelCase', () => {
    it('converts hyphenated string to camelCase', () => {
      expect(toCamelCase('my-agent')).toBe('myAgent');
    });

    it('converts underscore string to camelCase', () => {
      expect(toCamelCase('my_agent')).toBe('myAgent');
    });

    it('converts single word to camelCase', () => {
      expect(toCamelCase('agent')).toBe('agent');
    });

    it('handles mixed separators', () => {
      expect(toCamelCase('my_agent-name')).toBe('myAgentName');
    });
  });

  describe('toKebabCase', () => {
    it('converts PascalCase to kebab-case', () => {
      expect(toKebabCase('MyAgent')).toBe('my-agent');
    });

    it('converts camelCase to kebab-case', () => {
      expect(toKebabCase('myAgent')).toBe('my-agent');
    });

    it('converts underscores to kebab-case', () => {
      expect(toKebabCase('my_agent')).toBe('my-agent');
    });

    it('converts spaces to kebab-case', () => {
      expect(toKebabCase('my agent')).toBe('my-agent');
    });

    it('handles already kebab-case string', () => {
      expect(toKebabCase('my-agent')).toBe('my-agent');
    });
  });
});

describe('Handlebars template rendering', () => {
  describe('renderTemplate', () => {
    it('renders simple substitution', () => {
      const template = 'Hello, {{name}}!';
      const result = renderTemplate(template, { name: 'World' });
      expect(result).toBe('Hello, World!');
    });

    it('renders with #if conditional (true case)', () => {
      const template = '{{#if show}}visible{{else}}hidden{{/if}}';
      const result = renderTemplate(template, { show: true });
      expect(result).toBe('visible');
    });

    it('renders with #if conditional (false case)', () => {
      const template = '{{#if show}}visible{{else}}hidden{{/if}}';
      const result = renderTemplate(template, { show: false });
      expect(result).toBe('hidden');
    });

    it('renders with #each loop', () => {
      const template = '{{#each items}}{{this}}{{/each}}';
      const result = renderTemplate(template, { items: ['a', 'b', 'c'] });
      expect(result).toBe('abc');
    });

    it('renders with #each loop and separator', () => {
      const template = '{{#each items}}{{this}},{{/each}}';
      const result = renderTemplate(template, { items: ['a', 'b'] });
      expect(result).toBe('a,b,');
    });

    it('renders with nested object properties', () => {
      const template = '{{user.name}} is {{user.age}} years old';
      const result = renderTemplate(template, {
        user: { name: 'Alice', age: 30 },
      });
      expect(result).toBe('Alice is 30 years old');
    });

    it('uses pascalCase helper', () => {
      const template = '{{pascalCase name}}';
      const result = renderTemplate(template, { name: 'my-agent' });
      expect(result).toBe('MyAgent');
    });

    it('uses camelCase helper', () => {
      const template = '{{camelCase name}}';
      const result = renderTemplate(template, { name: 'my-agent' });
      expect(result).toBe('myAgent');
    });

    it('uses kebabCase helper', () => {
      const template = '{{kebabCase name}}';
      const result = renderTemplate(template, { name: 'MyAgent' });
      expect(result).toBe('my-agent');
    });

    it('uses eq helper (true case)', () => {
      const template = '{{#if (eq a b)}}equal{{/if}}';
      const result = renderTemplate(template, { a: 'foo', b: 'foo' });
      expect(result).toBe('equal');
    });

    it('uses eq helper (false case)', () => {
      const template = '{{#if (eq a b)}}equal{{/if}}';
      const result = renderTemplate(template, { a: 'foo', b: 'bar' });
      expect(result).toBe('');
    });

    it('uses neq helper', () => {
      const template = '{{#if (neq a b)}}different{{/if}}';
      const result = renderTemplate(template, { a: 'foo', b: 'bar' });
      expect(result).toBe('different');
    });

    it('uses and helper', () => {
      const template = '{{#if (and a b c)}}all true{{/if}}';
      const result = renderTemplate(template, { a: true, b: true, c: true });
      expect(result).toBe('all true');
    });

    it('uses or helper', () => {
      const template = '{{#if (or a b)}}at least one{{/if}}';
      const result = renderTemplate(template, { a: false, b: true });
      expect(result).toBe('at least one');
    });
  });
});

describe('File operations', () => {
  describe('writeFile', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('test-write-');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('writes file to existing directory', () => {
      const filePath = join(tempDir, 'test.txt');
      writeFile(filePath, 'Hello World');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe('Hello World');
    });

    it('creates nested directories if needed', () => {
      const filePath = join(tempDir, 'nested', 'deep', 'test.txt');
      writeFile(filePath, 'Nested content');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe('Nested content');
    });
  });
});

describe('Atomic directory operations', () => {
  describe('createTempDir', () => {
    let tempDir: string;

    afterEach(() => {
      if (tempDir) {
        cleanupTempDir(tempDir);
      }
    });

    it('creates a directory that exists', () => {
      tempDir = createTempDir();
      expect(existsSync(tempDir)).toBe(true);
    });

    it('creates directory with custom prefix', () => {
      tempDir = createTempDir('custom-prefix-');
      expect(existsSync(tempDir)).toBe(true);
      expect(tempDir.includes('custom-prefix-')).toBe(true);
    });

    it('creates unique directories on each call', () => {
      const dir1 = createTempDir();
      const dir2 = createTempDir();
      expect(dir1).not.toBe(dir2);
      cleanupTempDir(dir1);
      cleanupTempDir(dir2);
    });
  });

  describe('cleanupTempDir', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('cleanup-test-');
    });

    it('removes a directory', () => {
      expect(existsSync(tempDir)).toBe(true);
      cleanupTempDir(tempDir);
      expect(existsSync(tempDir)).toBe(false);
    });

    it('removes directory with files', () => {
      const filePath = join(tempDir, 'file.txt');
      writeFile(filePath, 'content');
      expect(existsSync(filePath)).toBe(true);

      cleanupTempDir(tempDir);
      expect(existsSync(tempDir)).toBe(false);
    });

    it('handles non-existent directory gracefully', () => {
      const nonExistent = join(tempDir, 'does-not-exist');
      // Should not throw
      cleanupTempDir(nonExistent);
      expect(existsSync(nonExistent)).toBe(false);
    });
  });
});