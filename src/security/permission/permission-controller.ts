/**
 * AgentForge Permission Controller
 *
 * Controls tool execution permissions using the HITL Observable pattern.
 */

import { Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
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
  ask(options: PermissionAskOptions): Observable<PermissionDecision>;
  onAsk(): Observable<PermissionPrompt>;
  answer(promptId: string, decision: PermissionDecision): void;
  isAutoAllowed(permission: string): boolean;
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

  ask(options: PermissionAskOptions): Observable<PermissionDecision> {
    if (this.isAutoAllowed(options.permission)) {
      return of('allow' as PermissionDecision);
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

    return this.channel
      .ask({
        promptId: options.promptId,
        source: this.source,
        question,
        context: askCtx,
        options: ['allow', 'deny', 'allow_always'],
      })
      .pipe(
        map(response => response as PermissionDecision),
        tap(decision => {
          if (decision === 'allow_always') {
            this.autoAllowSet.add(options.permission);
          }
        })
      );
  }

  answer(promptId: string, decision: PermissionDecision): void {
    this.channel.answer(promptId, decision);
  }

  onAsk(): Observable<PermissionPrompt> {
    return this.channel.onAsk().pipe(
      map(prompt => {
        const result: PermissionPrompt = {
          promptId: prompt.promptId,
          permission: prompt.question,
          options: ['allow', 'deny', 'allow_always'],
        };
        if (prompt.context !== undefined) {
          result.context = prompt.context;
        }
        return result;
      })
    );
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
