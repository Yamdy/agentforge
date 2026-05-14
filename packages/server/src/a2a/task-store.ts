import type { A2ATask, A2ATaskState, A2AMessage, A2AArtifact } from './types.js';
import { isValidTransition, isTerminal } from './types.js';

export class InMemoryTaskStore {
  private tasks = new Map<string, A2ATask>();
  private counter = 0;

  async create(contextId: string): Promise<A2ATask> {
    const id = `task-${++this.counter}`;
    const task: A2ATask = {
      id,
      contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      artifacts: [],
    };
    this.tasks.set(id, task);
    return { ...task };
  }

  async get(id: string): Promise<A2ATask | undefined> {
    const task = this.tasks.get(id);
    return task ? { ...task, history: [...(task.history ?? [])], artifacts: [...(task.artifacts ?? [])] } : undefined;
  }

  async updateStatus(id: string, state: A2ATaskState): Promise<A2ATask> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    if (!isValidTransition(task.status.state, state)) {
      throw new Error(`Invalid transition: ${task.status.state} → ${state}`);
    }
    task.status = { ...task.status, state, timestamp: new Date().toISOString() };
    return { ...task, history: [...(task.history ?? [])], artifacts: [...(task.artifacts ?? [])] };
  }

  async addMessage(id: string, message: A2AMessage): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    if (!task.history) task.history = [];
    task.history.push(message);
  }

  async addArtifact(id: string, artifact: A2AArtifact): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    if (!task.artifacts) task.artifacts = [];
    task.artifacts.push(artifact);
  }

  async cancel(id: string): Promise<A2ATask> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    if (isTerminal(task.status.state)) {
      throw new Error(`Cannot cancel task in terminal state: ${task.status.state}`);
    }
    task.status = { ...task.status, state: 'canceled', timestamp: new Date().toISOString() };
    return { ...task, history: [...(task.history ?? [])], artifacts: [...(task.artifacts ?? [])] };
  }

  async listByContext(contextId: string): Promise<A2ATask[]> {
    return Array.from(this.tasks.values()).filter((t) => t.contextId === contextId);
  }
}
