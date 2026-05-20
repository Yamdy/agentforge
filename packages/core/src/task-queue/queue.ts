/**
 * TaskQueue Implementation
 *
 * Manages long-running agent tasks with:
 * - Concurrent execution control
 * - Task status tracking
 * - Event emission
 * - Checkpoint-based recovery
 */
import type {
  TaskQueue,
  TaskQueueConfig,
  TaskQueueHandle,
  TaskStatus,
  TaskEvent,
  TaskOptions,
  CheckpointStore,
  PipelineCheckpoint,
} from '@primo-ai/sdk';
import { EventBus } from '../event-bus.js';
import { ConcurrencyController } from '../concurrency-controller.js';
import { InMemoryCheckpointStore, JsonlCheckpointStore } from '../checkpoint-store.js';
import type { Agent } from '../agent.js';

interface InternalTaskState {
  taskId: string;
  agentId: string;
  input: unknown;
  status: TaskStatus;
  progress?: number;
  result?: unknown;
  error?: Error;
  priority: number;
  createdAt: number;
  abortController?: AbortController;
  eventHandlers: Map<TaskEvent, Set<(data: unknown) => void>>;
  /** Flag to signal cancellation during acquire wait */
  cancelRequested?: boolean;
}

export class TaskQueueImpl implements TaskQueue {
  private tasks = new Map<string, InternalTaskState>();
  private agentRegistry: Map<string, Agent>;
  private concurrencyController: ConcurrencyController;
  private checkpointStore: CheckpointStore;
  private eventBus?: EventBus;
  private defaultSlotKey = 'default';

  constructor(
    agentRegistry: Map<string, Agent>,
    config: TaskQueueConfig & { eventBus?: EventBus } = {},
  ) {
    this.agentRegistry = agentRegistry;
    this.eventBus = config.eventBus;

    // ConcurrencyController requires ConcurrencySlot[] array
    this.concurrencyController = new ConcurrencyController([
      { key: this.defaultSlotKey, maxConcurrent: config.maxConcurrency ?? 4 },
    ]);

    this.checkpointStore = config.persistence === 'file'
      ? new JsonlCheckpointStore('.agentforge/task-queue')
      : new InMemoryCheckpointStore();
  }

  async enqueue(
    agentId: string,
    input: unknown,
    options?: TaskOptions,
  ): Promise<TaskQueueHandle> {
    const taskId = crypto.randomUUID();
    const state: InternalTaskState = {
      taskId,
      agentId,
      input,
      status: 'pending',
      priority: options?.priority ?? 0,
      createdAt: Date.now(),
      eventHandlers: new Map(),
    };

    this.tasks.set(taskId, state);
    this.eventBus?.emit('task:enqueued', { taskId, agentId, input });

    // Execute in background with proper error handling
    this.executeTask(taskId, options).catch((err) => {
      // Only handle if not already handled in executeTask
      if (state.status === 'pending') {
        this.handleTaskError(taskId, err);
      }
    });

    return this.createHandle(state);
  }

  async getStatus(taskId: string): Promise<TaskStatus> {
    return this.tasks.get(taskId)?.status ?? 'pending';
  }

  async getResult(taskId: string): Promise<unknown> {
    const state = this.tasks.get(taskId);
    if (!state) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (state.status !== 'completed') {
      throw new Error(`Task not completed: ${taskId} (status: ${state.status})`);
    }
    return state.result;
  }

  async cancel(taskId: string): Promise<void> {
    const state = this.tasks.get(taskId);
    if (!state) return;

    // Check if task can be cancelled
    if (state.status !== 'pending' && state.status !== 'running') {
      return;
    }

    // Signal cancellation (works for both waiting-to-acquire and running states)
    state.cancelRequested = true;
    state.abortController?.abort();
    state.status = 'cancelled';
    this.eventBus?.emit('task:cancelled', { taskId });
  }

  async resume(taskId: string): Promise<TaskQueueHandle> {
    const checkpoint = await this.checkpointStore.load(taskId);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for task: ${taskId}`);
    }

    const state = this.tasks.get(taskId);
    if (!state) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Reset cancellation flag
    state.cancelRequested = false;
    state.status = 'pending';

    this.executeTask(taskId, { resumeFrom: checkpoint as PipelineCheckpoint }).catch((err) => {
      if (state.status === 'pending') {
        this.handleTaskError(taskId, err);
      }
    });

    return this.createHandle(state);
  }

  async list(filter?: { status?: TaskStatus; agentId?: string }): Promise<TaskQueueHandle[]> {
    let states = Array.from(this.tasks.values());

    if (filter?.status) {
      states = states.filter((s) => s.status === filter.status);
    }
    if (filter?.agentId) {
      states = states.filter((s) => s.agentId === filter.agentId);
    }

    // Sort by priority (higher first), then by creation time
    states.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt - b.createdAt;
    });

    return states.map((s) => this.createHandle(s));
  }

  private async executeTask(
    taskId: string,
    options?: TaskOptions & { resumeFrom?: PipelineCheckpoint },
  ): Promise<void> {
    const state = this.tasks.get(taskId);
    if (!state) return;

    // Check if cancelled before acquiring slot
    if (state.cancelRequested) {
      return;
    }

    // Race acquire with cancellation check
    let releaseSlot: (() => void) | undefined;

    try {
      // Use a promise that can be cancelled
      const acquirePromise = this.concurrencyController.acquire(this.defaultSlotKey);

      // Wait for either acquire or cancellation
      releaseSlot = await Promise.race([
        acquirePromise,
        new Promise<undefined>((resolve) => {
          // Poll for cancellation
          const checkCancel = setInterval(() => {
            if (state.cancelRequested) {
              clearInterval(checkCancel);
              resolve(undefined);
            }
          }, 10);
          // Also clean up on acquire success
          acquirePromise.then(() => {
            clearInterval(checkCancel);
          });
        }),
      ]);

      // If cancelled during acquire wait, exit early
      if (!releaseSlot || state.cancelRequested) {
        return;
      }
    } catch (err) {
      // Acquire failed, check if cancelled
      if (state.cancelRequested) {
        return;
      }
      throw err;
    }

    try {
      // Double-check cancellation after acquiring slot
      if (state.cancelRequested) {
        return;
      }

      state.status = 'running';
      state.abortController = new AbortController();
      this.eventBus?.emit('task:started', { taskId, agentId: state.agentId });

      const agent = this.agentRegistry.get(state.agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${state.agentId}`);
      }

      // Handle resume from checkpoint
      let input: string;
      if (options?.resumeFrom) {
        // Deserialize checkpoint to get the context
        // PipelineCheckpoint has { context, nextStages, iteration }
        const checkpoint = options.resumeFrom;
        const restoredContext = checkpoint.context;
        // Use the restored input from checkpoint if available
        input = restoredContext?.request?.input ?? (state.input as string);
      } else {
        input = state.input as string;
      }

      // Set up timeout if specified
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (options?.timeout) {
        timeoutId = setTimeout(() => {
          state.abortController?.abort();
        }, options.timeout);
      }

      try {
        const result = await agent.run(input, state.abortController.signal);

        // Clear timeout on success
        if (timeoutId) clearTimeout(timeoutId);

        // Check if cancelled during execution
        if (state.abortController.signal.aborted || state.cancelRequested) {
          state.status = 'cancelled';
          this.eventBus?.emit('task:cancelled', { taskId });
          return;
        }

        state.status = 'completed';
        state.result = result;
        this.emitTaskEvent(state, 'complete', result);
        this.eventBus?.emit('task:completed', { taskId, result });
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        throw err;
      }
    } catch (err) {
      // Don't override if already cancelled
      if (state.status === 'cancelled') {
        return;
      }

      if (state.abortController?.signal.aborted || state.cancelRequested) {
        state.status = 'cancelled';
        this.eventBus?.emit('task:cancelled', { taskId });
      } else {
        state.status = 'failed';
        state.error = err instanceof Error ? err : new Error(String(err));
        this.emitTaskEvent(state, 'error', state.error);
        this.eventBus?.emit('task:failed', { taskId, error: state.error });
      }
    } finally {
      releaseSlot();
    }
  }

  private createHandle(state: InternalTaskState): TaskQueueHandle {
    const self = this;
    return {
      taskId: state.taskId,
      get status() {
        return state.status;
      },
      get progress() {
        return state.progress;
      },
      get result() {
        return state.result;
      },
      get error() {
        return state.error;
      },
      on(event: TaskEvent, handler: (data: unknown) => void): void {
        const handlers = state.eventHandlers.get(event) ?? new Set();
        handlers.add(handler);
        state.eventHandlers.set(event, handlers);
      },
      cancel(): void {
        self.cancel(state.taskId);
      },
    };
  }

  private emitTaskEvent(state: InternalTaskState, event: TaskEvent, data: unknown): void {
    const handlers = state.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  private handleTaskError(taskId: string, err: unknown): void {
    const state = this.tasks.get(taskId);
    if (state && state.status !== 'cancelled') {
      state.status = 'failed';
      state.error = err instanceof Error ? err : new Error(String(err));
      this.eventBus?.emit('task:error', { taskId, error: state.error });
    }
  }
}
