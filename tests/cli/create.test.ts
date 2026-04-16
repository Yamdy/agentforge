import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../src/cli/utils/template.js';
import { DEFAULT_DIR, LLM_PROVIDERS } from '../../src/cli/utils/constants.js';

describe('CLI create command', () => {
  describe('TEMPLATES', () => {
    it('should have gitignore template', () => {
      expect(TEMPLATES.gitignore).toBeDefined();
      expect(TEMPLATES.gitignore).toContain('node_modules');
      expect(TEMPLATES.gitignore).toContain('.env');
      expect(TEMPLATES.gitignore).toContain('dist');
    });

    it('should have all required templates', () => {
      expect(TEMPLATES).toHaveProperty('gitignore');
    });
  });

  describe('constants', () => {
    it('should have correct DEFAULT_DIR', () => {
      expect(DEFAULT_DIR).toBe('src');
    });

    it('should have LLM_PROVIDERS defined', () => {
      expect(LLM_PROVIDERS).toBeDefined();
      expect(Array.isArray(LLM_PROVIDERS)).toBe(true);
      expect(LLM_PROVIDERS).toContain('openai');
      expect(LLM_PROVIDERS).toContain('anthropic');
      expect(LLM_PROVIDERS).toContain('doubao');
    });
  });
});
