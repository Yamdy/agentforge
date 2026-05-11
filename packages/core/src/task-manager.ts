import type {
  AsyncTaskConfig,
  AsyncTaskHandle,
  AsyncTaskStatus,
  AgentConfig,
  SubAgentResult,
  TaskManager as ITaskManager,
} from '@agentforge/sdk';
import type { EventBus } from './event-bus.js';
import type { ConcurrencyController } from './concurrency-controller.js';

interface InternalTaskState {
  taskId: string;
  status: AsyncTaskStatus;
  result?: SubAgentResult;
  error?: Error;
  config: AsyncTaskConfig;
  abortController: AbortController;
  completionHandlers: Array<(result: SubAgentResult) => void>;
  parentSessionId?: string;
}

class InternalAsyncTaskHandle implements AsyncTaskHandle {
  private state: InternalTaskState;

  constructor(state: InternalTaskState) {
    this.state = state;
  }

  get taskId(): string {
    return this.state.taskId;
  }

  get status(): AsyncTaskStatus {
    return this.state.status;
  }

  get result(): SubAgentResult | undefined {
    return this.state.result;
  }

  get error(): Error | undefined {
    return this.state.error;
  }

  cancel(): void {
    if (
      this.state.status === 'pending' ||
      this.state.status === 'running'
    ) {
      this.state.status = 'cancelled';
      this.state.abortController.abort();
    }
  }

  on_complete(handler: (result: SubAgentResult) => void): void {
    // If already completed, call immediately
    if (this.state.status === 'completed' && this.state.result) {
      handler(this.state.result);
      return;
    }
    this.state.completionHandlers.push(handler);
  }

  /** Internal: parentSessionId for filtering */
  get _parentSessionId(): string | undefined {
    return this.state.parentSessionId;
  }
}

const defaultRunAgent = async (
  config: AgentConfig,
  input: string,
  _signal?: AbortSignal,
): Promise<SubAgentResult> => {
  const { Agent } = await import('./agent.js');
  const agent = new Agent(config);
  // TODO: integrate signal for cancellation
  const response = await agent.run(input);
  return {
    response,
    tokenUsage: { input: 0, output: 0 },
    sessionId: crypto.randomUUID(),
  };
};

export class TaskManagerImpl implements ITaskManager {
  private handles = new Map<string, InternalAsyncTaskHandle>();
  private eventBus?: EventBus;
  private concurrencyController?: ConcurrencyController;
  private runAgentFn: (
    config: AgentConfig,
    input: string,
    signal?: AbortSignal,
  ) => Promise<SubAgentResult>;

  constructor(options?: {
    eventBus?: EventBus;
    concurrencyController?: ConcurrencyController;
    runAgentFn?: (
      config: AgentConfig,
      input: string,
      signal?: AbortSignal,
    ) => Promise<SubAgentResult>;
  }) {
    this.eventBus = options?.eventBus;
    this.concurrencyController = options?.concurrencyController;
    this.runAgentFn = options?.runAgentFn ?? defaultRunAgent;
  }

  async launch(config: AsyncTaskConfig, prompt: string): Promise<AsyncTaskHandle> {
    const taskId = crypto.randomUUID();
    const abortController = new AbortController();

    const state: InternalTaskState = {
      taskId,
      status: 'pending',
      config,
      abortController,
      completionHandlers: [],
      parentSessionId: (config as any).parentSessionId,
    };

    const handle = new InternalAsyncTaskHandle(state);
    this.handles.set(taskId, handle);

    // Fire-and-forget the async work
    this.executeTask(state, config, prompt).catch(() => {
      // Errors are handled inside executeTask
    });

    return handle;
  }

  get(taskId: string): AsyncTaskHandle | undefined {
    return this.handles.get(taskId);
  }

  cancel(taskId: string): void {
    const handle = this.handles.get(taskId);
    if (handle) {
      handle.cancel();
    }
  }

  list(filter?: { parentSessionId?: string }): AsyncTaskHandle[] {
    let handles = Array.from(this.handles.values());

    if (filter?.parentSessionId) {
      handles = handles.filter(
        (h) => (h as InternalAsyncTaskHandle)._parentSessionId === filter.parentSessionId,
      );
    }

    return handles;
  }

  private async executeTask(
    state: InternalTaskState,
    config: AsyncTaskConfig,
    prompt: string,
  ): Promise<void> {
    const { signal } = state.abortController;

    // Check for cancellation before starting
    if (signal.aborted) return;

    // Acquire concurrency slot if configured
    let releaseSlot: (() => void) | undefined;
    if (config.concurrencySlot && this.concurrencyController) {
      releaseSlot = await this.concurrencyController.acquire(
        config.concurrencySlot.key,
      );
    }

    try {
      // Update status to running
      state.status = 'running';
      this.eventBus?.emit('task:start', { taskId: state.taskId, config });

      // Check cancellation again after acquiring slot
      if (signal.aborted) return;

      const agentConfig: AgentConfig = {
        model: (config as any).model ?? 'default',
        systemPrompt: config.systemPrompt,
        tools: config.tools,
        maxIterations: (config as any).maxIterations,
      };

      const result = await this.runAgentFn(agentConfig, prompt, signal);

      // Check if cancelled while running
      if (signal.aborted) return;

      state.status = 'completed';
      state.result = result;
      this.eventBus?.emit('task:end', {
        taskId: state.taskId,
        result,
      });

      // Fire completion handlers
      for (const handler of state.completionHandlers) {
        handler(result);
      }
    } catch (err) {
      if (signal.aborted) return;

      const error =
        err instanceof Error ? err : new Error(String(err));
      state.status = 'failed';
      state.error = error;
      this.eventBus?.emit('task:error', {
        taskId: state.taskId,
        error,
      });
      this.eventBus?.emit('task:end', {
        taskId: state.taskId,
        error,
      });
    } finally {
      releaseSlot?.();
    }
  }
}
