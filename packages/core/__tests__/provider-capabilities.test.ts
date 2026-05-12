import { describe, it, expect } from 'vitest';
import { detectProvider, detectCapabilities } from '../src/provider-capabilities.js';

describe('detectProvider', () => {
  it('extracts provider prefix from model string', () => {
    expect(detectProvider('deepseek/deepseek-v4-flash')).toBe('deepseek');
  });

  it('extracts anthropic provider', () => {
    expect(detectProvider('anthropic/claude-sonnet-4')).toBe('anthropic');
  });

  it('extracts openai provider', () => {
    expect(detectProvider('openai/gpt-4o')).toBe('openai');
  });

  it('extracts google provider', () => {
    expect(detectProvider('google/gemini-2.0-flash')).toBe('google');
  });

  it('returns empty string for model string without slash', () => {
    expect(detectProvider('gpt-4o')).toBe('');
  });

  it('returns empty string for slash at position 0', () => {
    expect(detectProvider('/model')).toBe('');
  });

  it('handles nested slashes — only first slash is provider boundary', () => {
    expect(detectProvider('openrouter/anthropic/claude-sonnet-4')).toBe('openrouter');
  });

  it('handles custom provider names', () => {
    expect(detectProvider('my-local/llama3')).toBe('my-local');
  });
});

describe('detectCapabilities', () => {
  it('returns DeepSeek capabilities with reasoning support', () => {
    const caps = detectCapabilities('deepseek/deepseek-v4-flash');
    expect(caps.supportsReasoning).toBe(true);
    expect(caps.supportsToolCalling).toBe(true);
    expect(caps.supportsParallelToolCalls).toBe(true);
    expect(caps.requiresAlternatingRoles).toBe(false);
    expect(caps.rejectsEmptyAssistantContent).toBe(false);
  });

  it('returns Anthropic capabilities with alternating roles requirement', () => {
    const caps = detectCapabilities('anthropic/claude-sonnet-4');
    expect(caps.supportsReasoning).toBe(true);
    expect(caps.supportsToolCalling).toBe(true);
    expect(caps.requiresAlternatingRoles).toBe(true);
    expect(caps.rejectsEmptyAssistantContent).toBe(true);
    expect(caps.toolCallIdPattern).toBeInstanceOf(RegExp);
  });

  it('returns OpenAI capabilities without reasoning support', () => {
    const caps = detectCapabilities('openai/gpt-4o');
    expect(caps.supportsReasoning).toBe(false);
    expect(caps.supportsToolCalling).toBe(true);
    expect(caps.supportsParallelToolCalls).toBe(true);
    expect(caps.requiresAlternatingRoles).toBe(false);
  });

  it('returns Google capabilities', () => {
    const caps = detectCapabilities('google/gemini-2.0-flash');
    expect(caps.supportsReasoning).toBe(false);
    expect(caps.supportsToolCalling).toBe(true);
    expect(caps.supportsParallelToolCalls).toBe(true);
  });

  it('returns conservative default for unknown provider', () => {
    const caps = detectCapabilities('unknown/model-x');
    expect(caps.supportsReasoning).toBe(false);
    expect(caps.supportsToolCalling).toBe(true);
    expect(caps.supportsParallelToolCalls).toBe(false);
    expect(caps.requiresAlternatingRoles).toBe(false);
    expect(caps.rejectsEmptyAssistantContent).toBe(false);
  });

  it('returns a copy — mutations do not affect subsequent calls', () => {
    const caps1 = detectCapabilities('unknown/model-x');
    caps1.supportsReasoning = true;
    caps1.supportsToolCalling = false;

    const caps2 = detectCapabilities('unknown/model-y');
    expect(caps2.supportsReasoning).toBe(false);
    expect(caps2.supportsToolCalling).toBe(true);
  });

  it('returns default for model string without slash', () => {
    const caps = detectCapabilities('gpt-4o');
    expect(caps.supportsParallelToolCalls).toBe(false);
  });
});
