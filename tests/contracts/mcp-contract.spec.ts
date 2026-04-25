/**
 * Unit tests for src/contracts/mcp-contract.ts
 *
 * Tests MCP tool response validation with graceful degradation.
 */

import { describe, it, expect } from 'vitest';
import {
  MCPToolResponseSchema,
  validateMCPResponse,
  type MCPToolResponse,
} from '../../src/contracts/mcp-contract.js';

// ============================================================
// Schema Validation
// ============================================================

describe('MCPToolResponseSchema', () => {
  it('should validate valid MCP response', () => {
    const response = {
      content: [{ type: 'text' as const, text: 'Hello' }],
      isError: false,
    };
    expect(MCPToolResponseSchema.safeParse(response).success).toBe(true);
  });

  it('should validate response with image content', () => {
    const response = {
      content: [{ type: 'image' as const, data: 'base64data', mimeType: 'image/png' }],
      isError: false,
    };
    expect(MCPToolResponseSchema.safeParse(response).success).toBe(true);
  });

  it('should validate response with resource content', () => {
    const response = {
      content: [{ type: 'resource' as const, text: 'resource content' }],
      isError: false,
    };
    expect(MCPToolResponseSchema.safeParse(response).success).toBe(true);
  });

  it('should default missing isError to false', () => {
    const response = {
      content: [{ type: 'text' as const, text: 'Hello' }],
    };
    const result = MCPToolResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isError).toBe(false);
    }
  });

  it('should reject invalid content type', () => {
    const response = {
      content: [{ type: 'audio' }],
      isError: false,
    };
    expect(MCPToolResponseSchema.safeParse(response).success).toBe(false);
  });
});

// ============================================================
// validateMCPResponse
// ============================================================

describe('validateMCPResponse', () => {
  describe('valid responses', () => {
    it('should pass valid MCP response unchanged', () => {
      const response = {
        content: [{ type: 'text' as const, text: 'Hello' }],
        isError: false,
      };
      const result = validateMCPResponse(response);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('Hello');
      expect(result.isError).toBe(false);
    });

    it('should pass response with multiple content items', () => {
      const response = {
        content: [
          { type: 'text' as const, text: 'Hello' },
          { type: 'image' as const, data: 'base64', mimeType: 'image/png' },
        ],
        isError: false,
      };
      const result = validateMCPResponse(response);
      expect(result.content).toHaveLength(2);
    });

    it('should pass response with error flag', () => {
      const response = {
        content: [{ type: 'text' as const, text: 'Error occurred' }],
        isError: true,
      };
      const result = validateMCPResponse(response);
      expect(result.isError).toBe(true);
    });
  });

  describe('graceful degradation', () => {
    it('should wrap string input as text content', () => {
      const result = validateMCPResponse('Hello, world!');
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('Hello, world!');
      expect(result.isError).toBe(false);
    });

    it('should wrap number input as text content (JSON stringified)', () => {
      const result = validateMCPResponse(42);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('42');
      expect(result.isError).toBe(false);
    });

    it('should wrap null input as text content', () => {
      const result = validateMCPResponse(null);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('null');
      expect(result.isError).toBe(false);
    });

    it('should wrap object input JSON stringified', () => {
      const result = validateMCPResponse({ key: 'value', num: 123 });
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('{"key":"value","num":123}');
      expect(result.isError).toBe(false);
    });

    it('should wrap array input JSON stringified', () => {
      const result = validateMCPResponse([1, 2, 3]);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('[1,2,3]');
    });

    it('should wrap undefined input as text content', () => {
      const result = validateMCPResponse(undefined);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('undefined');
    });

    it('should handle malformed content gracefully', () => {
      const result = validateMCPResponse({ content: 'not-an-array' });
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
    });
  });
});
