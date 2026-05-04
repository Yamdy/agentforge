/**
 * Unit tests for src/contracts/llm-contract.ts
 *
 * Tests LLM response validation with graceful degradation.
 */

import { describe, it, expect } from 'vitest';
import {
  LLMResponseContractSchema,
  validateLLMResponse,
  extractToolCall,
  type LLMResponse,
} from '../../src/contracts/llm-contract.js';

// ============================================================
// Schema Validation
// ============================================================

describe('LLMResponseContractSchema', () => {
  it('should validate complete LLM response', () => {
    const response = {
      content: 'Hello, world!',
      toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Paris' } }],
      finishReason: 'stop' as const,
      usage: { promptTokens: 100, completionTokens: 50 },
    };
    const result = LLMResponseContractSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('Hello, world!');
      expect(result.data.finishReason).toBe('stop');
      expect(result.data.usage?.promptTokens).toBe(100);
      expect(result.data.usage?.completionTokens).toBe(50);
    }
  });

  it('should validate minimal LLM response', () => {
    const response = {
      content: 'Hello',
      finishReason: 'stop' as const,
    };
    const result = LLMResponseContractSchema.safeParse(response);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('Hello');
      expect(result.data.finishReason).toBe('stop');
    }
  });

  it('should reject response without content', () => {
    const response = {
      finishReason: 'stop' as const,
    };
    const result = LLMResponseContractSchema.safeParse(response);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues.some(i => i.path.includes('content'))).toBe(true);
    }
  });

  it('should reject invalid finish reason', () => {
    const response = {
      content: 'Hello',
      finishReason: 'invalid',
    };
    const result = LLMResponseContractSchema.safeParse(response);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// validateLLMResponse
// ============================================================

describe('validateLLMResponse', () => {
  describe('valid responses', () => {
    it('should pass valid LLM response unchanged', () => {
      const response = {
        content: 'Hello, world!',
        toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Paris' } }],
        finishReason: 'stop' as const,
        usage: { promptTokens: 100, completionTokens: 50 },
      };
      const result = validateLLMResponse(response);
      expect(result.content).toBe('Hello, world!');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.finishReason).toBe('stop');
      expect(result.usage?.promptTokens).toBe(100);
    });

    it('should pass response with empty toolCalls array', () => {
      const response = {
        content: 'Hello',
        toolCalls: [],
        finishReason: 'stop' as const,
      };
      const result = validateLLMResponse(response);
      expect(result.content).toBe('Hello');
      expect(result.toolCalls).toEqual([]);
      expect(result.finishReason).toBe('stop');
    });
  });

  describe('graceful degradation', () => {
    it('should default missing content to empty string', () => {
      const result = validateLLMResponse({ finishReason: 'stop' });
      expect(result.content).toBe('');
    });

    it('should default missing toolCalls to undefined', () => {
      const result = validateLLMResponse({ content: 'Hello' });
      expect(result.toolCalls).toBeUndefined();
    });

    it('should default invalid finishReason to stop', () => {
      const result = validateLLMResponse({ content: 'Hello', finishReason: 'invalid' });
      expect(result.finishReason).toBe('stop');
    });

    it('should extract snake_case fields (tool_calls, finish_reason)', () => {
      const response = {
        content: 'Hello',
        tool_calls: [{ id: 'tc-1', name: 'weather', args: { city: 'Paris' } }],
        finish_reason: 'tool_calls',
      };
      const result = validateLLMResponse(response);
      expect(result.content).toBe('Hello');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls?.[0]?.id).toBe('tc-1');
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should return valid default for null input', () => {
      const result = validateLLMResponse(null);
      expect(result.content).toBe('');
      expect(result.toolCalls).toBeUndefined();
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toBeUndefined();
    });

    it('should return valid default for undefined input', () => {
      const result = validateLLMResponse(undefined);
      expect(result.content).toBe('');
      expect(result.toolCalls).toBeUndefined();
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toBeUndefined();
    });

    it('should extract toolCalls from malformed array', () => {
      const response = {
        content: 'Hello',
        toolCalls: [
          { id: 'tc-1', name: 'weather', args: { city: 'Paris' } },
          { id: 'tc-2' }, // missing name and args
        ],
        finishReason: 'stop' as const,
      };
      const result = validateLLMResponse(response);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls?.[0]?.name).toBe('weather');
      expect(result.toolCalls?.[1]?.name).toBe('unknown');
    });

    it('should set usage to undefined on degradation', () => {
      const result = validateLLMResponse({ content: 'Hello' });
      expect(result.usage).toBeUndefined();
    });
  });
});

// ============================================================
// extractToolCall
// ============================================================

describe('extractToolCall', () => {
  it('should extract valid tool call', () => {
    const raw = { id: 'tc-1', name: 'weather', args: { city: 'Paris' } };
    const result = extractToolCall(raw);
    expect(result.id).toBe('tc-1');
    expect(result.name).toBe('weather');
    expect(result.args).toEqual({ city: 'Paris' });
  });

  it('should generate id when missing', () => {
    const result = extractToolCall({ name: 'weather', args: {} });
    expect(result.id).toMatch(/^tc-/);
  });

  it('should use unknown for missing name', () => {
    const result = extractToolCall({ id: 'tc-1', args: {} });
    expect(result.name).toBe('unknown');
  });

  it('should default args to empty object', () => {
    const result = extractToolCall({ id: 'tc-1', name: 'weather' });
    expect(result.args).toEqual({});
  });

  it('should extract id from tool_call_id (snake_case)', () => {
    const result = extractToolCall({ tool_call_id: 'tc-123', name: 'weather', args: {} });
    expect(result.id).toBe('tc-123');
  });

  it('should extract name from function_name (snake_case)', () => {
    const result = extractToolCall({ id: 'tc-1', function_name: 'weather', args: {} });
    expect(result.name).toBe('weather');
  });

  it('should extract name from nested function.name', () => {
    const result = extractToolCall({ id: 'tc-1', function: { name: 'weather', arguments: '{}' } });
    expect(result.name).toBe('weather');
  });

  it('should extract args from arguments string (JSON)', () => {
    const result = extractToolCall({ id: 'tc-1', name: 'weather', arguments: '{"city":"Paris"}' });
    expect(result.args).toEqual({ city: 'Paris' });
  });

  it('should handle invalid arguments JSON gracefully', () => {
    const result = extractToolCall({ id: 'tc-1', name: 'weather', arguments: 'invalid-json' });
    expect(result.args).toEqual({});
  });

  it('should extract args from nested function.arguments', () => {
    const result = extractToolCall({ id: 'tc-1', function: { arguments: '{"city":"Paris"}' } });
    expect(result.args).toEqual({ city: 'Paris' });
  });

  it('should handle null input gracefully', () => {
    const result = extractToolCall(null);
    expect(result.id).toMatch(/^tc-/);
    expect(result.name).toBe('unknown');
    expect(result.args).toEqual({});
  });

  it('should handle undefined input gracefully', () => {
    const result = extractToolCall(undefined);
    expect(result.id).toMatch(/^tc-/);
    expect(result.name).toBe('unknown');
    expect(result.args).toEqual({});
  });
});
