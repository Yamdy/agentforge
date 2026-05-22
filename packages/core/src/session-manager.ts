import type { SessionStorage, SessionRecord, SessionManager, PipelineContext, SessionEvent, Message, SnapshotService, FilePatch } from '@primo-ai/sdk';
import type { EventBus } from './event-bus.js';

export class SessionManagerImpl implements SessionManager {
  private snapshotService?: SnapshotService;

  constructor(
    private storage: SessionStorage,
    private bus: EventBus,
    snapshotService?: SnapshotService,
    private permissionManager?: { applyDecision(id: string, approved: boolean): void },
  ) {
    this.snapshotService = snapshotService;
  }

  async start(input: string, options?: { parentSessionId?: string }): Promise<SessionRecord> {
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: SessionRecord = {
      sessionId,
      parentSessionId: options?.parentSessionId,
      createdAt: now,
      updatedAt: now,
      status: 'active',
    };

    await this.storage.updateMeta(sessionId, record);

    this.bus.emit('agent:start', { sessionId, input });

    // Probabilistic GC: ~10% chance to trigger cleanup on each start()
    if (Math.random() < 0.1) {
      this.storage.cleanup().catch((err) => {
        this.bus.emit('session:cleanup_error', { error: err instanceof Error ? err.message : String(err) });
      });
    }

    return record;
  }

  async restore(sessionId: string): Promise<PipelineContext> {
    const events: SessionEvent[] = [];
    for await (const event of this.storage.read(sessionId)) {
      events.push(event);
    }

    if (events.length === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    let input = '';
    let lastStep = 0;
    const messageHistory: Message[] = [];
    let agentConfig: Record<string, unknown> = {};
    let promptFragments: string[] = [];
    let toolDeclarations: Array<{ name: string; description: string }> = [];
    let totalTokenUsage: { input: number; output: number } | undefined;
    let lastResponse: string | undefined;
    const custom: Record<string, unknown> = {};
    let toolCallIdx = 0;
    const snapshotIds: string[] = [];

    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (!payload) continue;

      switch (event.type) {
        case 'agent:start': {
          if (payload.input) input = payload.input as string;
          if (payload.agentConfig) agentConfig = payload.agentConfig as Record<string, unknown>;
          if (payload.promptFragments) promptFragments = payload.promptFragments as string[];
          if (payload.toolDeclarations) toolDeclarations = payload.toolDeclarations as Array<{ name: string; description: string }>;
          break;
        }
        case 'permission:decided':
          if (this.permissionManager) {
            const pd = payload as Record<string,unknown>;
            this.permissionManager.applyDecision(String(pd.permissionId ?? ''), Boolean(pd.approved));
          }
          break;
        case 'iteration:end':
        case 'iteration.end': {
          lastStep = (payload.step as number) + 1;
          if (payload.response) {
            lastResponse = payload.response as string;
            const msg: Message = { role: 'assistant', content: payload.response as string };
            messageHistory.push(msg);
          }
          if (payload.tokenUsage) {
            totalTokenUsage = payload.tokenUsage as { input: number; output: number };
          }
          break;
        }
        case 'tool:before':
        case 'tool.before': {
          // tool.before is a pre-execution hook event; skip — tool:after carries the result
          break;
        }
        case 'tool:after':
        case 'tool.after': {
          const toolName = payload.toolName as string;
          const content = payload.error
            ? String(payload.error)
            : typeof payload.result === 'string'
              ? payload.result
              : JSON.stringify(payload.result ?? '');
          const msg: Message = {
            role: 'tool',
            content,
            toolCallId: `restored_${toolName}_${toolCallIdx++}`,
            toolName,
          };
          if (payload.error) (msg as Message & { error?: string }).error = String(payload.error);
          if (payload.result !== undefined) (msg as Message & { result?: unknown }).result = payload.result;
          messageHistory.push(msg);
          break;
        }
        case 'llm:after':
        case 'llm.after': {
          if (payload.tokenUsage) {
            const usage = payload.tokenUsage as { input: number; output: number };
            totalTokenUsage = totalTokenUsage
              ? { input: totalTokenUsage.input + usage.input, output: totalTokenUsage.output + usage.output }
              : usage;
          }
          break;
        }
        case 'error': {
          messageHistory.push({ role: 'assistant', content: `[Error] ${String(payload.error)}` });
          break;
        }
        case 'session:suspended': {
          custom.suspendReason = payload.reason;
          break;
        }
        case 'snapshot:track': {
          if (payload.snapshotId) snapshotIds.push(payload.snapshotId as string);
          break;
        }
        case 'stage:before':
        case 'stage:after':
        case 'llm:before':
        case 'agent:end':
          break;
      }
    }

    return {
      request: { input, sessionId },
      agent: { config: agentConfig as unknown as PipelineContext['agent']['config'], promptFragments, toolDeclarations },
      iteration: { step: lastStep, response: lastResponse },
      session: { messageHistory, totalTokenUsage, custom: { ...custom, snapshotIds } },
    };
  }

  async suspend(sessionId: string, reason: string): Promise<void> {
    // Emit through EventBus so SessionPersistence handles seq + write
    this.bus.emit('session:suspended', { sessionId, reason });

    await this.storage.updateMeta(sessionId, { status: 'suspended' });
  }

  async resume(sessionId: string, input?: string): Promise<string> {
    // Mark original session as completed
    await this.storage.updateMeta(sessionId, { status: 'completed' });

    // Start a new continuation session linked to the original
    const child = await this.start(input ?? '', { parentSessionId: sessionId });
    return child.sessionId;
  }

  async resumeInPlace(sessionId: string): Promise<void> {
    const meta = await this.storage.get(sessionId);
    if (!meta) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (meta.status !== 'suspended') {
      throw new Error(`Session is not suspended: ${sessionId} (current: ${meta.status})`);
    }

    await this.storage.updateMeta(sessionId, { status: 'active' });
    this.bus.emit('session:resumed', { sessionId });
  }

  async list(filter?: { parentSessionId?: string }): Promise<SessionRecord[]> {
    return this.storage.list(filter);
  }

  async getSessionSnapshots(sessionId: string): Promise<string[]> {
    const events: SessionEvent[] = [];
    for await (const event of this.storage.read(sessionId)) {
      events.push(event);
    }

    const snapshotIds: string[] = [];
    for (const event of events) {
      if (event.type === 'snapshot:track') {
        const payload = event.payload as Record<string, unknown> | undefined;
        if (payload?.snapshotId) {
          snapshotIds.push(payload.snapshotId as string);
        }
      }
    }

    return snapshotIds;
  }

  async getSessionPatches(sessionId: string): Promise<FilePatch[]> {
    if (!this.snapshotService) {
      return [];
    }

    const snapshotIds = await this.getSessionSnapshots(sessionId);
    if (snapshotIds.length === 0) {
      return [];
    }

    // Use the most recent snapshot
    const latestSnapshotId = snapshotIds[snapshotIds.length - 1];
    if (!latestSnapshotId) {
      return [];
    }

    return this.snapshotService.patch(latestSnapshotId);
  }
}
