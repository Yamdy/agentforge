import { describe, it, expect } from 'vitest';
import {
  applyPreemptiveRules,
  applyReactiveRules,
  BUILTIN_COMPAT_RULES,
} from '../src/processors/provider-history-compat.js';
import type { Message, ProviderCapabilities, CompatRule, ToolCall } from '@agentforge/sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const deepseekCaps: ProviderCapabilities = {
  supportsReasoning: true,
  supportsToolCalling: true,
  supportsParallelToolCalls: true,
  requiresAlternatingRoles: false,
  rejectsEmptyAssistantContent: false,
};

const anthropicCaps: ProviderCapabilities = {
  supportsReasoning: true,
  supportsToolCalling: true,
  supportsParallelToolCalls: true,
  requiresAlternatingRoles: true,
  rejectsEmptyAssistantContent: true,
  toolCallIdPattern: /^[a-zA-Z0-9_-]+$/,
};

const openaiCaps: ProviderCapabilities = {
  supportsReasoning: false,
  supportsToolCalling: true,
  supportsParallelToolCalls: true,
  requiresAlternatingRoles: false,
  rejectsEmptyAssistantContent: false,
};

const defaultCaps: ProviderCapabilities = {
  supportsReasoning: false,
  supportsToolCalling: true,
  supportsParallelToolCalls: false,
  requiresAlternatingRoles: false,
  rejectsEmptyAssistantContent: false,
};

// ---------------------------------------------------------------------------
// Preemptive rules
// ---------------------------------------------------------------------------

describe('applyPreemptiveRules', () => {
  it('returns empty array unchanged', () => {
    const result = applyPreemptiveRules([], 'openai/gpt-4o', openaiCaps);
    expect(result).toEqual([]);
  });

  it('returns messages unchanged when no rules apply', () => {
    const msgs = [{ role: 'user', content: 'hello' }];
    const result = applyPreemptiveRules(msgs, 'unknown/model', defaultCaps);
    // strip-unsupported-reasoning (wildcard) runs on unknown provider too,
    // but since no reasoning parts exist, it returns same array (mapped, new ref)
    expect(result).toEqual(msgs);
  });

  // --- strip-unsupported-reasoning ---

  it('strips reasoning parts from messages for providers without reasoning support', () => {
    const msgs = [
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'thinking...' },
        { type: 'text', text: 'answer' },
      ]},
    ];
    const result = applyPreemptiveRules(msgs, 'openai/gpt-4o', openaiCaps);
    expect((result[0] as { content: Array<{ type: string; text: string }> }).content).toEqual([
      { type: 'text', text: 'answer' },
    ]);
  });

  it('keeps reasoning parts for providers that support reasoning', () => {
    const msgs = [
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'thinking...' },
        { type: 'text', text: 'answer' },
      ]},
    ];
    const result = applyPreemptiveRules(msgs, 'deepseek/deepseek-v4-flash', deepseekCaps);
    expect((result[0] as { content: unknown[] }).content).toHaveLength(2);
  });

  it('does not modify non-assistant messages when stripping reasoning', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'think' }] },
    ];
    const result = applyPreemptiveRules(msgs, 'openai/gpt-4o', openaiCaps);
    expect((result[0] as { content: string }).content).toBe('hello');
  });

  // --- strip-foreign-reasoning (Anthropic) ---

  it('strips all reasoning parts for Anthropic (foreign reasoning)', () => {
    const msgs = [
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'deepthink' },
        { type: 'text', text: 'result' },
      ]},
    ];
    const result = applyPreemptiveRules(msgs, 'anthropic/claude', anthropicCaps);
    expect((result[0] as { content: Array<{ type: string; text: string }> }).content).toEqual([
      { type: 'text', text: 'result' },
    ]);
  });

  // --- ensure-alternating-roles (Anthropic) ---

  it('inserts empty user message between consecutive assistant messages for Anthropic', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
    ];
    const result = applyPreemptiveRules(msgs, 'anthropic/claude', anthropicCaps);
    const roles = result.map((m: unknown) => (m as { role: string }).role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('does not insert when roles already alternate', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
      { role: 'user', content: 'next' },
    ];
    const result = applyPreemptiveRules(msgs, 'anthropic/claude', anthropicCaps);
    expect(result).toHaveLength(3);
  });

  it('does not insert between consecutive user messages (only assistant→assistant)', () => {
    const msgs = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ];
    const result = applyPreemptiveRules(msgs, 'anthropic/claude', anthropicCaps);
    expect(result).toHaveLength(2);
  });

  // --- fix-empty-assistant-content ---

  it('adds space text to assistant message with no text content', () => {
    const msgs = [
      { role: 'assistant', content: [
        { type: 'tool-use', id: 't1', name: 'foo', input: {} },
      ]},
    ];
    const result = applyPreemptiveRules(msgs, 'anthropic/claude', anthropicCaps);
    const content = (result[0] as { content: Array<{ type: string; text?: string }> }).content;
    expect(content.some((p) => p.type === 'text' && p.text === ' ')).toBe(true);
  });

  it('does not add space when assistant already has text', () => {
    const msgs = [
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ];
    const result = applyPreemptiveRules(msgs, 'anthropic/claude', anthropicCaps);
    const texts = (result[0] as { content: Array<{ type: string }> }).content.filter((p) => p.type === 'text');
    expect(texts).toHaveLength(1);
  });

  // --- mixed content types ---

  it('handles mixed content: reasoning + text + tool-use', () => {
    const msgs = [
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'think' },
        { type: 'text', text: '' },
        { type: 'tool-use', id: 't1', name: 'fn', input: {} },
      ]},
    ];
    const result = applyPreemptiveRules(msgs, 'openai/gpt-4o', openaiCaps);
    const content = (result[0] as { content: Array<{ type: string }> }).content;
    expect(content.every((p) => p.type !== 'reasoning')).toBe(true);
    expect(content.some((p) => p.type === 'tool-use')).toBe(true);
  });

  // --- wildcard + provider-specific rule ordering ---

  it('applies wildcard rules then provider-specific rules in sequence', () => {
    const msgs = [
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'think' },
      ]},
      { role: 'assistant', content: [
        { type: 'text', text: 'a' },
      ]},
    ];
    const result = applyPreemptiveRules(msgs, 'anthropic/claude', anthropicCaps);
    const roles = result.map((m: unknown) => (m as { role: string }).role);
    expect(roles).toEqual(['assistant', 'user', 'assistant']);
  });
});

// ---------------------------------------------------------------------------
// Reactive rules
// ---------------------------------------------------------------------------

describe('applyReactiveRules', () => {
  it('returns null when no error patterns match', () => {
    const history = [{ role: 'assistant' as const, content: 'hello' }];
    const result = applyReactiveRules(history, 'openai/gpt-4o', new Error('unrelated error'));
    expect(result).toBeNull();
  });

  it('returns null for empty history', () => {
    const result = applyReactiveRules([], 'deepseek/model', new Error('reasoning_content must be passed back'));
    expect(result).toBeNull();
  });

  // --- sanitize-tool-call-ids (Anthropic) ---

  it('sanitizes tool call IDs with invalid characters for Anthropic', () => {
    const history = [
      { role: 'assistant' as const, content: 'text', toolCalls: [
        { id: 'call!@#$', name: 'tool1', args: {} },
      ] },
    ];
    const err = new Error('tool call id format invalid');
    const result = applyReactiveRules(history, 'anthropic/claude', err);
    expect(result).not.toBeNull();
    expect((result!.history[0] as { toolCalls: ToolCall[] }).toolCalls[0].id).toBe('call____');
    expect(result!.diff.length).toBeGreaterThan(0);
  });

  it('returns null when tool call IDs are already valid', () => {
    const history = [
      { role: 'assistant' as const, content: 'text', toolCalls: [
        { id: 'call_abc-123', name: 'tool1', args: {} },
      ] },
    ];
    const err = new Error('tool call id format invalid');
    const result = applyReactiveRules(history, 'anthropic/claude', err);
    expect(result).toBeNull();
  });

  it('does not match sanitize rule for non-Anthropic provider', () => {
    const history = [
      { role: 'assistant' as const, content: 'text', toolCalls: [
        { id: 'call!@#$', name: 'tool1', args: {} },
      ] },
    ];
    const err = new Error('tool call id format invalid');
    const result = applyReactiveRules(history, 'openai/gpt-4o', err);
    expect(result).toBeNull();
  });

  // --- deepseek-reasoning-required ---

  it('adds empty reasoningContent to last assistant message for DeepSeek', () => {
    const history = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'response' },
    ];
    const err = new Error('reasoning_content must be passed back');
    const result = applyReactiveRules(history, 'deepseek/deepseek-v4-flash', err);
    expect(result).not.toBeNull();
    expect((result!.history[1] as { reasoningContent: string }).reasoningContent).toBe('');
    expect(result!.diff.length).toBeGreaterThan(0);
  });

  it('does not add reasoningContent if already present', () => {
    const history = [
      { role: 'assistant' as const, content: 'response', reasoningContent: 'existing' },
    ];
    const err = new Error('reasoning_content must be passed back');
    const result = applyReactiveRules(history, 'deepseek/deepseek-v4-flash', err);
    expect(result).toBeNull();
  });

  it('does not add reasoningContent to non-last assistant message', () => {
    const history = [
      { role: 'assistant' as const, content: 'first' },
      { role: 'user' as const, content: 'follow-up' },
      { role: 'assistant' as const, content: 'second', reasoningContent: 'exists' },
    ];
    const err = new Error('reasoning_content must be passed back');
    const result = applyReactiveRules(history, 'deepseek/deepseek-v4-flash', err);
    expect(result).toBeNull();
  });

  it('does not match DeepSeek rule for non-DeepSeek provider', () => {
    const history = [
      { role: 'assistant' as const, content: 'response' },
    ];
    const err = new Error('reasoning_content must be passed back');
    const result = applyReactiveRules(history, 'openai/gpt-4o', err);
    expect(result).toBeNull();
  });

  // --- string (non-Error) error ---

  it('handles string error by converting to string', () => {
    const history = [
      { role: 'assistant' as const, content: 'response' },
    ];
    const result = applyReactiveRules(history, 'deepseek/deepseek-v4-flash', 'reasoning_content must be passed back');
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Custom rules
// ---------------------------------------------------------------------------

describe('custom rule list', () => {
  it('applyPreemptiveRules accepts custom rules', () => {
    const customRule: CompatRule = {
      name: 'test-rule',
      providers: '*',
      applyToPrompt(messages: unknown[]): unknown[] {
        return [{ role: 'system', content: 'injected' }, ...messages];
      },
    };
    const msgs = [{ role: 'user', content: 'hello' }];
    const result = applyPreemptiveRules(msgs, 'openai/gpt-4o', defaultCaps, [customRule]);
    expect(result).toHaveLength(2);
    expect((result[0] as { role: string }).role).toBe('system');
  });

  it('applyReactiveRules accepts custom rules', () => {
    const customRule: CompatRule = {
      name: 'test-reactive',
      providers: '*',
      errorPatterns: [/custom error/i],
      fixHistory(history) {
        return history.map((msg) => ({ ...msg, patched: true }));
      },
    };
    const history = [{ role: 'assistant' as const, content: 'text' }];
    const result = applyReactiveRules(history, 'openai/gpt-4o', new Error('custom error'), [customRule]);
    expect(result).not.toBeNull();
    expect((result!.history[0] as unknown as { patched: boolean }).patched).toBe(true);
    expect(result!.diff.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// BUILTIN_COMPAT_RULES registry
// ---------------------------------------------------------------------------

describe('BUILTIN_COMPAT_RULES', () => {
  it('contains exactly 6 rules', () => {
    expect(BUILTIN_COMPAT_RULES).toHaveLength(6);
  });

  it('all rules have unique names', () => {
    const names = BUILTIN_COMPAT_RULES.map(r => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has 4 preemptive rules (applyToPrompt)', () => {
    expect(BUILTIN_COMPAT_RULES.filter(r => r.applyToPrompt)).toHaveLength(4);
  });

  it('has 2 reactive rules (fixHistory + errorPatterns)', () => {
    expect(BUILTIN_COMPAT_RULES.filter(r => r.fixHistory && r.errorPatterns)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// R-2: Reactive compat marks modified history entries
// ---------------------------------------------------------------------------

describe('A-6: reactive compat does NOT leak _compatFixed into history', () => {
  it('sanitizeToolCallIds strips _compatFixed from returned history', () => {
    const history = [
      { role: 'assistant' as const, content: 'ok', toolCalls: [{ id: 'tc!bad@id', name: 'foo', args: {} }] },
      { role: 'tool' as const, content: 'result', toolCallId: 'tc!bad@id', toolName: 'foo' },
    ];
    const result = applyReactiveRules(history, 'anthropic/claude', new Error('tool id invalid format'));
    expect(result).not.toBeNull();

    for (const msg of result!.history) {
      expect('_compatFixed' in (msg as Record<string, unknown>)).toBe(false);
    }

    expect(result!.diff.length).toBeGreaterThan(0);
    expect(result!.diff[0].ruleName).toBe('sanitize-tool-call-ids');
  });

  it('deepseekReasoningRequired strips _compatFixed from returned history', () => {
    const history = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi' },
    ];
    const result = applyReactiveRules(history, 'deepseek/chat', new Error('reasoning_content must be passed back'));
    expect(result).not.toBeNull();

    for (const msg of result!.history) {
      expect('_compatFixed' in (msg as Record<string, unknown>)).toBe(false);
    }

    expect(result!.diff.length).toBeGreaterThan(0);
    expect(result!.diff[0].ruleName).toBe('deepseek-reasoning-required');
  });
});
