import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ConfigLoader, loadConfigSync } from '../../src/config/index.js';
import { AppError } from '../../src/errors/index.js';

describe('ConfigLoader', () => {
  describe('constructor', () => {
    it('should create with default search paths', () => {
      const loader = new ConfigLoader();
      expect(loader).toBeInstanceOf(ConfigLoader);
    });

    it('should accept custom search paths', () => {
      const loader = new ConfigLoader(['/custom/path']);
      expect(loader).toBeInstanceOf(ConfigLoader);
    });
  });

  describe('mergeConfigs', () => {
    it('should merge multiple configs correctly', () => {
      const loader = new ConfigLoader();
      const base = {
        name: 'base',
        agent: {
          name: 'Base Agent',
          tools: ['calculator'],
        },
      };

      const overlay = {
        environment: 'production',
        agent: {
          maxSteps: 20,
          tools: ['web_search'],
        },
      };

      const result = loader.mergeConfigs(base, overlay);
      expect(result.name).toBe('base');
      expect(result.environment).toBe('production');
      expect(result.agent.name).toBe('Base Agent');
      expect(result.agent.maxSteps).toBe(20);
      expect(result.agent.tools).toEqual(['calculator', 'web_search']);
    });
  });

  describe('findConfigFile', () => {
    it('should find config when it exists', () => {
      // Search from project root where we have agentforge.config.md
      const loader = new ConfigLoader([process.cwd()]);
      const result = loader.findConfigFile();
      expect(result).not.toBeNull();
      expect(result).toContain('agentforge.config.md');
    });
  });

  describe('loadConfigSync', () => {
    it('should load and validate JSON config', () => {
      const testJsonPath = path.join(__dirname, 'test-config.json');
      const testConfig = {
        name: 'test',
        agent: {
          name: 'Test Agent',
          model: 'gpt-4o',
        },
      };

      fs.writeFileSync(testJsonPath, JSON.stringify(testConfig));

      try {
        const loader = new ConfigLoader();
        const result = loader.loadConfigSync({ filePath: testJsonPath });
        expect(result.name).toBe('test');
        expect(result.agent.model).toBe('gpt-4o');
      } finally {
        fs.unlinkSync(testJsonPath);
      }
    });

    it('should throw error for non-existent file', () => {
      const loader = new ConfigLoader();
      expect(() => {
        loader.loadConfigSync({ filePath: 'non-existent.md' });
      }).toThrow(AppError);
    });

    it('should throw error for invalid file extension', () => {
      const testFile = path.join(__dirname, 'test.txt');
      fs.writeFileSync(testFile, 'test');
      try {
        const loader = new ConfigLoader();
        expect(() => {
          loader.loadConfigSync({ filePath: testFile });
        }).toThrow(/INVALID_CONFIG_FORMAT|Unsupported config file format/);
      } finally {
        fs.unlinkSync(testFile);
      }
    });
  });
});
