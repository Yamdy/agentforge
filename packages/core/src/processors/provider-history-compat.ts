import type { CompatRule, ProviderCapabilities } from '@agentforge/sdk';
import { detectProvider } from '../provider-capabilities.js';

// ---------------------------------------------------------------------------
// Message shape for compat rules
// ---------------------------------------------------------------------------

type MessageShape = {
  role: string;
  content: unknown;
  toolCalls?: Array<{ id: string; [key: string]: unknown }>;
  reasoningContent?: string;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Built-in compat rules
// ---------------------------------------------------------------------------

const stripUnsupportedReasoning: CompatRule = {
  name: 'strip-unsupported-reasoning',
  providers: '*',
  applyToPrompt(messages: unknown[], capabilities: ProviderCapabilities): unknown[] {
    if (capabilities.supportsReasoning) return messages;
    return messages.map((msg) => {
      const m = msg as MessageShape;
      if (m.role !== 'assistant' || !Array.isArray(m.content)) return msg;
      const filtered = m.content.filter((part) => (part as { type: string }).type !== 'reasoning');
      return filtered.length === m.content.length ? msg : { ...m, content: filtered };
    });
  },
};

const stripForeignReasoning: CompatRule = {
  name: 'strip-foreign-reasoning',
  providers: ['anthropic'],
  applyToPrompt(messages: unknown[]): unknown[] {
    return messages.map((msg) => {
      const m = msg as MessageShape;
      if (m.role !== 'assistant' || !Array.isArray(m.content)) return msg;
      const filtered = m.content.filter((part) => (part as { type: string }).type !== 'reasoning');
      return filtered.length === m.content.length ? msg : { ...m, content: filtered };
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
      const lastRole = (result[result.length - 1] as MessageShape | undefined)?.role;
      const currentRole = (msg as MessageShape).role;
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
    return messages.map((msg) => {
      const m = msg as MessageShape;
      if (m.role !== 'assistant') return msg;
      if (!Array.isArray(m.content)) return msg;
      const hasText = m.content.some(
        (part) => {
          const p = part as { type: string; text?: string };
          return p.type === 'text' && p.text && p.text.length > 0;
        },
      );
      if (hasText) return msg;
      return { ...m, content: [...m.content, { type: 'text', text: ' ' }] };
    });
  },
};

const sanitizeToolCallIds: CompatRule = {
  name: 'sanitize-tool-call-ids',
  providers: ['anthropic'],
  errorPatterns: [/tool.*id.*invalid/i, /tool.*id.*format/i],
  fixHistory(history, _error) {
    let changed = false;
    const next = history.map((msg) => {
      const m = msg as MessageShape;
      if (m.role !== 'assistant' || !m.toolCalls) return msg;
      const toolCalls = m.toolCalls.map((tc) => {
        const sanitized = String(tc.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        if (sanitized !== tc.id) { changed = true; return { ...tc, id: sanitized }; }
        return tc;
      });
      return changed ? { ...m, toolCalls } : msg;
    });
    return changed ? next as import('@agentforge/sdk').Message[] : null;
  },
};

const deepseekReasoningRequired: CompatRule = {
  name: 'deepseek-reasoning-required',
  providers: ['deepseek'],
  errorPatterns: [/reasoning_content.*must be passed back/i],
  fixHistory(history, _error) {
    let changed = false;
    const next = history.map((msg, i: number) => {
      const m = msg as MessageShape;
      if (m.role !== 'assistant' || m.reasoningContent) return msg;
      const hasLaterAssistant = history.slice(i + 1).some((h) => (h as MessageShape).role === 'assistant');
      if (hasLaterAssistant) return msg;
      changed = true;
      return { ...m, reasoningContent: '' };
    });
    return changed ? next as import('@agentforge/sdk').Message[] : null;
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

/** Try reactive rules against an API error. Returns fixed history + diff, or null. */
export function applyReactiveRules(
  history: import('@agentforge/sdk').Message[],
  modelString: string,
  error: unknown,
  rules: CompatRule[] = BUILTIN_COMPAT_RULES,
): import('@agentforge/sdk').CompatResult | null {
  const provider = detectProvider(modelString);
  const errorMsg = error instanceof Error ? error.message : String(error);
  for (const rule of rules) {
    if (!rule.fixHistory || !rule.errorPatterns) continue;
    if (rule.providers !== '*' && !rule.providers.includes(provider)) continue;
    if (!rule.errorPatterns.some(p => p.test(errorMsg))) continue;
    const fixed = rule.fixHistory(history, error);
    if (fixed) {
      const diff: import('@agentforge/sdk').CompatDiffEntry[] = [];
      const patched = fixed.map((msg: unknown, i: number): import('@agentforge/sdk').Message => {
        const original = (history as unknown[])[i];
        if (msg !== original) {
          diff.push({ index: i, ruleName: rule.name, description: `modified by ${rule.name}` });
        }
        const { _compatFixed, ...clean } = msg as MessageShape & { _compatFixed?: boolean };
        return clean as import('@agentforge/sdk').Message;
      });
      return { history: patched, diff };
    }
  }
  return null;
}
