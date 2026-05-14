import type { CompatRule, ProviderCapabilities } from '@agentforge/sdk';
import { detectProvider } from '../provider-capabilities.js';

// ---------------------------------------------------------------------------
// Built-in compat rules
// ---------------------------------------------------------------------------

const stripUnsupportedReasoning: CompatRule = {
  name: 'strip-unsupported-reasoning',
  providers: '*',
  applyToPrompt(messages: unknown[], capabilities: ProviderCapabilities): unknown[] {
    if (capabilities.supportsReasoning) return messages;
    return messages.map((msg: any) => {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;
      const filtered = msg.content.filter((part: any) => part.type !== 'reasoning');
      return filtered.length === msg.content.length ? msg : { ...msg, content: filtered };
    });
  },
};

const stripForeignReasoning: CompatRule = {
  name: 'strip-foreign-reasoning',
  providers: ['anthropic'],
  applyToPrompt(messages: unknown[]): unknown[] {
    return messages.map((msg: any) => {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;
      const filtered = msg.content.filter((part: any) => part.type !== 'reasoning');
      return filtered.length === msg.content.length ? msg : { ...msg, content: filtered };
    });
  },
};

const ensureAlternatingRoles: CompatRule = {
  name: 'ensure-alternating-roles',
  providers: ['anthropic'],
  applyToPrompt(messages: unknown[], capabilities: ProviderCapabilities): unknown[] {
    if (!capabilities.requiresAlternatingRoles) return messages;
    const result: unknown[] = [];
    for (const msg of messages) {
      const lastRole = (result[result.length - 1] as any)?.role;
      const currentRole = (msg as any).role;
      if (lastRole && lastRole === currentRole && lastRole === 'assistant') {
        result.push({ role: 'user', content: [{ type: 'text', text: ' ' }] });
      }
      result.push(msg);
    }
    return result;
  },
};

const fixEmptyAssistantContent: CompatRule = {
  name: 'fix-empty-assistant-content',
  providers: '*',
  applyToPrompt(messages: unknown[], capabilities: ProviderCapabilities): unknown[] {
    if (!capabilities.rejectsEmptyAssistantContent) return messages;
    return messages.map((msg: any) => {
      if (msg.role !== 'assistant') return msg;
      if (!Array.isArray(msg.content)) return msg;
      const hasText = msg.content.some((part: any) =>
        part.type === 'text' && part.text && part.text.length > 0,
      );
      if (hasText) return msg;
      return { ...msg, content: [...msg.content, { type: 'text', text: ' ' }] };
    });
  },
};

const sanitizeToolCallIds: CompatRule = {
  name: 'sanitize-tool-call-ids',
  providers: ['anthropic'],
  errorPatterns: [/tool.*id.*invalid/i, /tool.*id.*format/i],
  fixHistory(history, _error) {
    let changed = false;
    const next = history.map((msg: any) => {
      if (msg.role !== 'assistant' || !msg.toolCalls) return msg;
      const toolCalls = msg.toolCalls.map((tc: any) => {
        const sanitized = tc.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (sanitized !== tc.id) { changed = true; return { ...tc, id: sanitized }; }
        return tc;
      });
      return changed ? { ...msg, toolCalls } : msg;
    });
    return changed ? next : null;
  },
};

const deepseekReasoningRequired: CompatRule = {
  name: 'deepseek-reasoning-required',
  providers: ['deepseek'],
  errorPatterns: [/reasoning_content.*must be passed back/i],
  fixHistory(history, _error) {
    let changed = false;
    const next = history.map((msg: any, i: number) => {
      if (msg.role !== 'assistant' || msg.reasoningContent) return msg;
      const hasLaterAssistant = history.slice(i + 1).some((m: any) => m.role === 'assistant');
      if (hasLaterAssistant) return msg;
      changed = true;
      return { ...msg, reasoningContent: '' };
    });
    return changed ? next : null;
  },
};

// ---------------------------------------------------------------------------
// Rule registry & application
// ---------------------------------------------------------------------------

export const BUILTIN_COMPAT_RULES: CompatRule[] = [
  stripUnsupportedReasoning,
  stripForeignReasoning,
  ensureAlternatingRoles,
  fixEmptyAssistantContent,
  sanitizeToolCallIds,
  deepseekReasoningRequired,
];

/** Apply all matching preemptive rules to a message list. */
export function applyPreemptiveRules(
  messages: unknown[],
  modelString: string,
  capabilities: ProviderCapabilities,
  rules: CompatRule[] = BUILTIN_COMPAT_RULES,
): unknown[] {
  const provider = detectProvider(modelString);
  let result = messages;
  for (const rule of rules) {
    if (!rule.applyToPrompt) continue;
    if (rule.providers !== '*' && !rule.providers.includes(provider)) continue;
    result = rule.applyToPrompt(result, capabilities);
  }
  return result;
}

/** Try reactive rules against an API error. Returns fixed history or null. */
export function applyReactiveRules(
  history: import('@agentforge/sdk').Message[],
  modelString: string,
  error: unknown,
  rules: CompatRule[] = BUILTIN_COMPAT_RULES,
): import('@agentforge/sdk').Message[] | null {
  const provider = detectProvider(modelString);
  const errorMsg = error instanceof Error ? error.message : String(error);
  for (const rule of rules) {
    if (!rule.fixHistory || !rule.errorPatterns) continue;
    if (rule.providers !== '*' && !rule.providers.includes(provider)) continue;
    if (!rule.errorPatterns.some(p => p.test(errorMsg))) continue;
    const fixed = rule.fixHistory(history, error);
    if (fixed) {
      return fixed.map((msg: any, i: number) => {
        const original = (history as any[])[i];
        return msg !== original ? { ...msg, _compatFixed: true } : msg;
      });
    }
  }
  return null;
}
