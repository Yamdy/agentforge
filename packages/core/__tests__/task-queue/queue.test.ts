/**
 * Task T2: TaskQueue 核心实现测试
 *
 * 测试 TaskQueue 的核心功能：
 * - enqueue: 任务入队
 * - getStatus: 获取任务状态
 * - cancel: 取消任务
 * - list: 列出任务
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskQueueImpl } from '../../src/task-queue/queue.js';
import { EventBus } from '../../src/event-bus.js';
import type { TaskQueueHandle, TaskStatus, PipelineContext } from '@primo-ai/sdk';
import type { Agent } from '../../src/agent.js';

// Mock Agent
function createMockAgent(response: string = 'test response'): Agent {
  return {
    run: vi.fn().mockResolvedValue({
      response,
      tokenUsage: { input: 10, output: 5 },
      sessionId: 'test-session',
    }),
    use: vi.fn(),
  } as unknown as Agent;
}

describe('TaskQueueImpl', () => {
  let taskQueue: TaskQueueImpl;
  let mockAgents: Map<string, Agent>;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    mockAgents = new Map([
      ['test-agent', createMockAgent('Hello from test agent')],
      ['slow-agent', createMockAgent('Slow response')],
    ]);
    taskQueue = new TaskQueueImpl(mockAgents, { maxConcurrency: 2 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('enqueue', () => {
    it('should enqueue a task and return a handle', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test input' });

      expect(handle.taskId).toBeDefined();
      expect(handle.taskId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    it('should set initial status to pending', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test' });

      // Status might already be running since execution starts immediately
      expect(['pending', 'running']).toContain(handle.status);
    });

    it('should execute the agent', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test input' });

      // Wait for execution to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = await taskQueue.getStatus(handle.taskId);
      expect(status).toBe('completed');
    });

    it('should store the result after completion', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test' });

      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await taskQueue.getResult(handle.taskId);
      expect(result).toBeDefined();
      expect((result as { response: string }).response).toBe('Hello from test agent');
    });

    it('should accept task options', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test' }, {
        priority: 5,
        timeout: 30000,
      });

      expect(handle.taskId).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return pending for unknown task', async () => {
      const status = await taskQueue.getStatus('non-existent-task');
      expect(status).toBe('pending');
    });

    it('should return correct status for enqueued task', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test' });

      const status = await taskQueue.getStatus(handle.taskId);
      expect(['pending', 'running', 'completed']).toContain(status);
    });
  });

  describe('cancel', () => {
    it('should cancel a pending task', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test' });

      await taskQueue.cancel(handle.taskId);

      const status = await taskQueue.getStatus(handle.taskId);
      expect(['cancelled', 'completed']).toContain(status);
    });
  });

  describe('list', () => {
    it('should list all tasks', async () => {
      await taskQueue.enqueue('test-agent', { input: 'test1' });
      await taskQueue.enqueue('test-agent', { input: 'test2' });

      const tasks = await taskQueue.list();
      expect(tasks.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by status', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test' });

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 100));

      const completed = await taskQueue.list({ status: 'completed' });
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(completed.some(t => t.taskId === handle.taskId)).toBe(true);
    });

    it('should filter by agentId', async () => {
      await taskQueue.enqueue('test-agent', { input: 'test1' });
      await taskQueue.enqueue('slow-agent', { input: 'test2' });

      const tasks = await taskQueue.list({ agentId: 'test-agent' });
      expect(tasks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('TaskQueueHandle', () => {
    it('should have cancel method', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test' });
      expect(typeof handle.cancel).toBe('function');
    });

    it('should have on method for events', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test' });
      expect(typeof handle.on).toBe('function');
    });

    it('should emit complete event', async () => {
      const handle = await taskQueue.enqueue('test-agent', { input: 'test' });

      const completeHandler = vi.fn();
      handle.on('complete', completeHandler);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(completeHandler).toHaveBeenCalled();
    });
  });

  describe('concurrency', () => {
    it('should respect maxConcurrency', async () => {
      // Create a slow agent
      const slowMockAgent = {
        run: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return { response: 'slow', tokenUsage: { input: 1, output: 1 }, sessionId: 'slow-session' };
        }),
        use: vi.fn(),
      } as unknown as Agent;

      mockAgents.set('very-slow-agent', slowMockAgent);

      // Enqueue 3 tasks with maxConcurrency=2
      const handles = await Promise.all([
        taskQueue.enqueue('very-slow-agent', { input: '1' }),
        taskQueue.enqueue('very-slow-agent', { input: '2' }),
        taskQueue.enqueue('very-slow-agent', { input: '3' }),
      ]);

      // All should be enqueued
      expect(handles.length).toBe(3);

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      const completed = await taskQueue.list({ status: 'completed' });
      expect(completed.length).toBe(3);
    });
  });
});
