/**
 * Unit tests for otel-attributes.ts — attribute constants and extraction helpers.
 *
 * Tests: constant uniqueness, extractLLMAttributes, extractToolAttributes.
 * Pure constants and functions with no dependencies — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import {
  ATTR_AGENTFORGE_CACHE_READ_TOKENS,
  ATTR_AGENTFORGE_CACHE_WRITE_TOKENS,
  ATTR_AGENTFORGE_TTFT_MS,
  ATTR_AGENTFORGE_COST,
  ATTR_AGENTFORGE_CACHE_SAVINGS,
  ATTR_AGENTFORGE_TOOL_ERROR_TYPE,
  ATTR_AGENTFORGE_EVAL_SCORE,
  ATTR_AGENTFORGE_EVAL_RUN_ID,
  ATTR_AGENTFORGE_ERROR_CODE,
  OPERATION_EXECUTE_TOOL,
  extractLLMAttributes,
  extractToolAttributes,
} from '../../src/observability/tracers/otel-attributes.js';

// ============================================================
// Extract all constants for uniqueness check
// ============================================================

const allAttributeConstants = [
  ATTR_AGENTFORGE_CACHE_READ_TOKENS,
  ATTR_AGENTFORGE_CACHE_WRITE_TOKENS,
  ATTR_AGENTFORGE_TTFT_MS,
  ATTR_AGENTFORGE_COST,
  ATTR_AGENTFORGE_CACHE_SAVINGS,
  ATTR_AGENTFORGE_TOOL_ERROR_TYPE,
  ATTR_AGENTFORGE_EVAL_SCORE,
  ATTR_AGENTFORGE_EVAL_RUN_ID,
  ATTR_AGENTFORGE_ERROR_CODE,
];

describe('Attribute Constants', () => {
  it('all exported constants are unique strings', () => {
    const seen = new Set<string>();
    for (const attr of allAttributeConstants) {
      expect(seen.has(attr)).toBe(false);
      seen.add(attr);
    }
  });

  it('all custom attributes use agentforge.* namespace', () => {
    for (const attr of allAttributeConstants) {
      expect(attr.startsWith('agentforge.')).toBe(true);
    }
  });
});

// ============================================================
// extractLLMAttributes
// ============================================================

describe('extractLLMAttributes', () => {
  it('produces all 5 attributes when all fields provided', () => {
    const result = extractLLMAttributes({
      model: 'gpt-4o',
      provider: 'openai',
      messagesCount: 10,
      toolsCount: 3,
      maxTokens: 4096,
    });
    expect(Object.keys(result)).toHaveLength(6);
    expect(result['gen_ai.operation.name']).toBe('chat');
    expect(result['gen_ai.request.model']).toBe('gpt-4o');
    expect(result['gen_ai.provider.name']).toBe('openai');
    expect(result['gen_ai.request.messages_count']).toBe(10);
    expect(result['gen_ai.request.tools_count']).toBe(3);
    expect(result['gen_ai.request.max_tokens']).toBe(4096);
  });

  it('excludes toolsCount when undefined', () => {
    const result = extractLLMAttributes({
      model: 'gpt-4o',
      provider: 'openai',
      messagesCount: 5,
    });
    expect(result).not.toHaveProperty('gen_ai.request.tools_count');
  });

  it('excludes toolsCount when 0', () => {
    const result = extractLLMAttributes({
      model: 'gpt-4o',
      provider: 'openai',
      messagesCount: 5,
      toolsCount: 0,
    });
    expect(result).not.toHaveProperty('gen_ai.request.tools_count');
  });

  it('defaults maxTokens to 0 when omitted', () => {
    const result = extractLLMAttributes({
      model: 'gpt-4o',
      provider: 'openai',
      messagesCount: 5,
    });
    expect(result['gen_ai.request.max_tokens']).toBe(0);
  });

  it('includes messagesCount even when 0', () => {
    const result = extractLLMAttributes({
      model: 'gpt-4o',
      provider: 'openai',
      messagesCount: 0,
    });
    expect(result['gen_ai.request.messages_count']).toBe(0);
  });
});

// ============================================================
// extractToolAttributes
// ============================================================

describe('extractToolAttributes', () => {
  it('produces exactly 3 attributes', () => {
    const result = extractToolAttributes({ name: 'read_file', argumentsSize: 100 });
    expect(Object.keys(result)).toHaveLength(3);
    expect(result['gen_ai.operation.name']).toBe(OPERATION_EXECUTE_TOOL);
    expect(result['gen_ai.tool.name']).toBe('read_file');
    expect(result['gen_ai.tool.arguments_size']).toBe(100);
  });

  it('handles zero argumentsSize', () => {
    const result = extractToolAttributes({ name: 'noop', argumentsSize: 0 });
    expect(result['gen_ai.tool.arguments_size']).toBe(0);
  });

  it('handles empty tool name', () => {
    const result = extractToolAttributes({ name: '', argumentsSize: 50 });
    expect(result['gen_ai.tool.name']).toBe('');
  });
});
