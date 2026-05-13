import type { Processor, PipelineContext, ProcessorResult, AbortSignal, HarnessAPI, PluginRegistration } from '@agentforge/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PermissionRule {
  /** Tool name or glob pattern (e.g., "file_*", "shell_exec") */
  tool: string;
  /** Action to take when rule matches */
  action: 'allow' | 'deny' | 'ask';
  /** Optional glob pattern matching against argument paths */
  pattern?: string;
}

export type PermissionMode = 'interactive' | 'plan-only' | 'full-auto';

export interface PermissionDecisionEvent {
  /** The decision made: 'allow', 'deny', or 'ask' (suspended for approval) */
  decision: 'allow' | 'deny' | 'ask';
  /** The tool name that was evaluated */
  toolName: string;
  /** The rule that matched (tool pattern), or undefined for default decisions */
  rule?: string;
  /** The permission mode under which the decision was made */
  mode: PermissionMode;
}

export interface PermissionConfig {
  mode: PermissionMode;
  rules: PermissionRule[];
  /** Callback invoked on every permission decision for audit trail */
  onDecision?: (event: PermissionDecisionEvent) => void;
}

// ---------------------------------------------------------------------------
// Built-in dangerous tool patterns for plan-only mode
// ---------------------------------------------------------------------------

const DANGEROUS_TOOL_PATTERNS = [
  'shell_exec',
  'file_write',
  'file_delete',
  'npm_publish',
  'git_push',
  'git_commit',
  'ssh',
  'scp',
  'docker_run',
  'docker_exec',
] as const;

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

/**
 * Simple glob pattern matching supporting `*` (any segment) and `?` (single char).
 * Uses minimatch-style semantics: `*` matches any sequence of characters
 * within a path segment (does NOT cross `/` boundaries).
 * `**` matches any sequence including `/`.
 */
function globMatch(pattern: string, text: string): boolean {
  const p = pattern.replace(/\\/g, '/');
  const t = text.replace(/\\/g, '/');

  const regexStr = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');

  return new RegExp(`^${regexStr}$`).test(t);
}

/**
 * Match a tool name against a pattern.
 * Tool names don't have path separators, so * matches any characters.
 */
function toolNameMatch(pattern: string, toolName: string): boolean {
  if (pattern === toolName) return true;
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`).test(toolName);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentToolCall(ctx: PipelineContext): { name: string; args: Record<string, unknown> } | undefined {
  const calls = ctx.iteration.pendingToolCalls;
  return calls && calls.length > 0 ? { name: calls[0].name, args: calls[0].args } : undefined;
}

function isDangerousTool(toolName: string): boolean {
  return DANGEROUS_TOOL_PATTERNS.includes(toolName as (typeof DANGEROUS_TOOL_PATTERNS)[number]);
}

/**
 * Evaluate rules against a tool call using first-match-wins.
 * Returns the matching rule's action, or undefined if no rule matched.
 */
function evaluateRules(
  rules: PermissionRule[],
  toolName: string,
  args: Record<string, unknown>,
): { action: PermissionRule['action']; rule: PermissionRule } | undefined {
  for (const rule of rules) {
    if (!toolNameMatch(rule.tool, toolName)) continue;

    if (rule.pattern) {
      const patternMatched = Object.values(args).some(
        (val) => typeof val === 'string' && globMatch(rule.pattern!, val),
      );
      if (!patternMatched) continue;
    }

    return { action: rule.action, rule };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// PermissionProcessor
// ---------------------------------------------------------------------------

export function createPermissionProcessor(config: PermissionConfig): Processor {
  const emit = config.onDecision ?? (() => {});

  return {
    stage: 'gateTool',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      // full-auto mode: allow everything
      if (config.mode === 'full-auto') {
        return ctx;
      }

      const toolCall = getCurrentToolCall(ctx);
      if (!toolCall) {
        return ctx;
      }

      // Evaluate rules (first-match-wins)
      const matched = evaluateRules(config.rules, toolCall.name, toolCall.args);

      if (matched) {
        switch (matched.action) {
          case 'allow':
            emit({ decision: 'allow', toolName: toolCall.name, rule: matched.rule.tool, mode: config.mode });
            return ctx;
          case 'deny':
            emit({ decision: 'deny', toolName: toolCall.name, rule: matched.rule.tool, mode: config.mode });
            return { type: 'abort', reason: `Permission denied: tool '${toolCall.name}' blocked by rule (deny)` };
          case 'ask':
            // In plan-only mode, 'ask' is treated as deny
            if (config.mode === 'plan-only') {
              emit({ decision: 'deny', toolName: toolCall.name, rule: matched.rule.tool, mode: config.mode });
              return { type: 'abort', reason: `Permission denied: tool '${toolCall.name}' requires approval (ask rule, plan-only mode)` };
            }
            // In interactive mode, 'ask' suspends awaiting human approval
            emit({ decision: 'ask', toolName: toolCall.name, rule: matched.rule.tool, mode: config.mode });
            return { type: 'abort', reason: `Tool '${toolCall.name}' requires approval (ask rule)` };
        }
      }

      // No rule matched — apply mode defaults
      if (config.mode === 'plan-only') {
        if (isDangerousTool(toolCall.name)) {
          emit({ decision: 'deny', toolName: toolCall.name, mode: config.mode });
          return { type: 'abort', reason: `Permission denied: tool '${toolCall.name}' is not allowed in plan-only mode (dangerous tool)` };
        }
        emit({ decision: 'allow', toolName: toolCall.name, mode: config.mode });
        return ctx;
      }

      // interactive mode with no matching rule: allow by default
      emit({ decision: 'allow', toolName: toolCall.name, mode: config.mode });
      return ctx;
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin Factory
// ---------------------------------------------------------------------------

export interface PermissionPluginOptions {
  mode: PermissionMode;
  rules: PermissionRule[];
}

/**
 * PermissionPlugin factory function.
 * Creates a PermissionProcessor registered at the `gateTool` stage.
 * Each permission decision is emitted through the `onDecision` callback,
 * which the plugin wires to the EventBus via HarnessAPI.subscribe.
 */
export function permissionPlugin(options: PermissionPluginOptions): (api: HarnessAPI) => PluginRegistration {
  return (api: HarnessAPI): PluginRegistration => {
    const processor = createPermissionProcessor({
      mode: options.mode,
      rules: options.rules,
      onDecision: (event: PermissionDecisionEvent) => {
        api.emit('permission.decision', event);
      },
    });

    api.registerProcessor('gateTool', processor);

    return { processors: [processor] };
  };
}