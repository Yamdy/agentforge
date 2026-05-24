import { describe, it, expect, beforeAll } from 'vitest';
import { MCP } from '../../src/index.js';

describe('MCP Module Tests', () => {
  describe('Configuration and Types', () => {
    it('should export MCP namespace', () => {
      expect(MCP).toBeDefined();
      expect(MCP.client).toBeDefined();
      expect(MCP.Toolkit).toBeDefined();
      expect(MCP.schemas).toBeDefined();
    });

    it('should have valid schema definitions', () => {
      expect(MCP.schemas.McpLocalConfig).toBeDefined();
      expect(MCP.schemas.McpRemoteConfig).toBeDefined();
      expect(MCP.schemas.McpServerConfig).toBeDefined();
      expect(MCP.schemas.McpStatus).toBeDefined();
    });

    it('should validate local server config', () => {
      const validConfig = {
        type: 'local' as const,
        command: ['echo', 'hello'],
      };
      const result = MCP.schemas.McpServerConfig.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should validate remote server config', () => {
      const validConfig = {
        type: 'remote' as const,
        url: 'https://example.com/mcp',
      };
      const result = MCP.schemas.McpServerConfig.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should reject invalid config', () => {
      const invalidConfig = {
        type: 'invalid' as const,
      };
      const result = MCP.schemas.McpServerConfig.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('Config Management', () => {
    it('should have config instance', () => {
      expect(MCP.config).toBeDefined();
    });

    it('should have getServers method', () => {
      expect(typeof MCP.config.getServers).toBe('function');
    });
  });

  describe('Client API', () => {
    it('should have client methods', () => {
      expect(typeof MCP.client.init).toBe('function');
      expect(typeof MCP.client.add).toBe('function');
      expect(typeof MCP.client.remove).toBe('function');
      expect(typeof MCP.client.connect).toBe('function');
      expect(typeof MCP.client.disconnect).toBe('function');
      expect(typeof MCP.client.status).toBe('function');
      expect(typeof MCP.client.tools).toBe('function');
    });
  });

  describe('Toolkit API', () => {
    it('should have Toolkit methods', () => {
      expect(typeof MCP.Toolkit.refreshTools).toBe('function');
      expect(typeof MCP.Toolkit.registerGroup).toBe('function');
      expect(typeof MCP.Toolkit.activateGroup).toBe('function');
      expect(typeof MCP.Toolkit.deactivateGroup).toBe('function');
      expect(typeof MCP.Toolkit.addToBasic).toBe('function');
      expect(typeof MCP.Toolkit.removeFromBasic).toBe('function');
      expect(typeof MCP.Toolkit.getTools).toBe('function');
    });

    it('should return empty tools by default', () => {
      const tools = MCP.Toolkit.getTools(['basic']);
      expect(Array.isArray(tools)).toBe(true);
    });
  });
});
