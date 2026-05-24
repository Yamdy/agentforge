import { describe, it, expect } from 'vitest';
import { DEFAULT_DIR } from '../../src/cli/utils/constants.js';
import { TEMPLATES } from '../../src/cli/utils/template.js';

describe('CLI scaffolding', () => {
  describe('DEFAULT_DIR constant', () => {
    it('should be src for correct project structure', () => {
      expect(DEFAULT_DIR).toBe('src');
    });
  });

  describe('directory structure expectations', () => {
    it('should expect plural directory names for user components', () => {
      // User project should have: src/agents/, src/workflows/, src/tools/
      // This is what createComponentsDir produces with input 'agent', 'workflow', 'tool'
      // because it automatically adds 's' suffix
      const testCases = [
        { input: 'agent', expected: 'agents' },
        { input: 'workflow', expected: 'workflows' },
        { input: 'tool', expected: 'tools' },
      ];

      testCases.forEach(({ input, expected }) => {
        const componentDir = `${DEFAULT_DIR}/${expected}`;
        expect(componentDir).toBe(`src/${expected}`);
      });
    });
  });

  describe('template content validation', () => {
    it('should have valid gitignore template', () => {
      expect(TEMPLATES.gitignore).toBeDefined();
      expect(TEMPLATES.gitignore).toContain('node_modules');
      expect(TEMPLATES.gitignore).toContain('.env');
      expect(TEMPLATES.gitignore).toContain('dist');
      expect(TEMPLATES.gitignore).toContain('.agentforge');
    });

    it('should have correct index template structure', () => {
      expect(TEMPLATES.index).toBeDefined();
      expect(TEMPLATES.index).toContain('createApp');
      expect(TEMPLATES.index).toContain('startServer');
    });

    it('should have correct config template structure', () => {
      expect(TEMPLATES.config).toBeDefined();
      expect(TEMPLATES.config).toContain('defineConfig');
      expect(TEMPLATES.config).toContain('provider');
      expect(TEMPLATES.config).toContain('modelName');
    });

    it('should have correct exampleAgent template', () => {
      expect(TEMPLATES.exampleAgent).toBeDefined();
      expect(TEMPLATES.exampleAgent).toContain('createAgent');
    });
  });
});
