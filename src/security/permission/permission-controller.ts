/**
 * AgentForge Permission Controller
 *
 * Controls tool execution permissions using callback-based approval pattern.
 */

import type { ApprovalChannel, ApprovalSource } from '../../core/approval-channel.js';

// ============================================================
// Types
// ============================================================

export type PermissionDecision = 'allow' | 'deny' | 'allow_always';

export interface PermissionAskOptions {
  promptId: string;
  permission: string;
  context?: Record<string, unknown>;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface PermissionPrompt {
  promptId: string;
  permission: string;
  context?: Record<string, unknown>;
  options: PermissionDecision[];
}

// ============================================================
// Interface
// ============================================================

export interface PermissionController {
  /** Request permission — returns Promise that resolves when human answers */
  ask(options: PermissionAskOptions): Promise<PermissionDecision>;

  /** Subscribe to permission prompts (for UI). Returns unsubscribe. */
  onAsk(listener: (prompt: PermissionPrompt) => void): () => void;

  /** Provide an answer */
  answer(promptId: string, decision: PermissionDecision): void;

  /** Check if a permission is auto-allowed */
  isAutoAllowed(permission: string): boolean;

  /** Cancel a pending permission request */
  cancel(promptId: string): void;
}

// ============================================================
// Default Implementation
// ============================================================

export class DefaultPermissionController implements PermissionController {
  private readonly channel: ApprovalChannel;
  private readonly source: ApprovalSource = 'permission';
  private autoAllowSet = new Set<string>();

  constructor(channel: ApprovalChannel) {
    this.channel = channel;
  }

  ask(options: PermissionAskOptions): Promise<PermissionDecision> {
    if (this.isAutoAllowed(options.permission)) {
      return Promise.resolve('allow' as PermissionDecision);
    }

    const ctx = options.context;
    let askCtx: Record<string, unknown> = {};
    if (ctx !== undefined) {
      askCtx = { ...ctx };
    }

    const question =
      ctx && typeof ctx.approvalMessage === 'string'
        ? ctx.approvalMessage
        : `Allow tool: ${options.permission}?`;

    return new Promise<PermissionDecision>((resolve) => {
      this.channel.ask(
        {
          promptId: options.promptId,
          source: this.source,
          question,
          context: askCtx,
          options: ['allow', 'deny', 'allow_always'],
        },
        (response: string) => {
          const decision = response as PermissionDecision;
          if (decision === 'allow_always') {
            this.autoAllowSet.add(options.permission);
          }
          resolve(decision);
        }
      );
    });
  }

  answer(promptId: string, decision: PermissionDecision): void {
    this.channel.answer(promptId, decision);
  }

  onAsk(listener: (prompt: PermissionPrompt) => void): () => void {
    return this.channel.onAsk((raw) => {
      const result: PermissionPrompt = {
        promptId: raw.promptId,
        permission: raw.question,
        options: ['allow', 'deny', 'allow_always'],
      };
      if (raw.context !== undefined) {
        result.context = raw.context;
      }
      listener(result);
    });
  }

  isAutoAllowed(permission: string): boolean {
    return this.autoAllowSet.has(permission);
  }

  cancel(promptId: string): void {
    // Cancel by answering with 'deny'
    this.channel.answer(promptId, 'deny');
  }

  clearAutoAllow(): void {
    this.autoAllowSet.clear();
  }
}
