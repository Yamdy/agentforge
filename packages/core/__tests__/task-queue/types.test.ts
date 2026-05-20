/**
 * Task T1: SDK 类型定义测试
 *
 * 验证 TaskQueue 相关类型在 @primo-ai/sdk 中正确定义。
 * 编译成功即证明类型存在且结构正确。
 */
import { describe, it, expect } from 'vitest';
import type {
  TaskQueueConfig,
  TaskQueueHandle,
  TaskStatus,
  TaskEvent,
  TaskOptions,
  TaskQueue,
} from '@primo-ai/sdk';

describe('TaskQueue Types', () => {
  it('TaskStatus has correct values', () => {
    const statuses: TaskStatus[] = [
      'pending',
      'running',
      'suspended',
      'completed',
      'failed',
      'cancelled',
    ];
    expect(statuses).toHaveLength(6);
  });

  it('TaskEvent has correct values', () => {
    const events: TaskEvent[] = ['progress', 'complete', 'error', 'suspend'];
    expect(events).toHaveLength(4);
  });

  it('TaskQueueConfig accepts valid config', () => {
    const config: TaskQueueConfig = {
      maxConcurrency: 4,
      persistence: 'memory',
      checkpointInterval: 1000,
    };
    expect(config.maxConcurrency).toBe(4);
  });

  it('TaskQueueConfig allows partial config', () => {
    const emptyConfig: TaskQueueConfig = {};
    const partialConfig: TaskQueueConfig = { maxConcurrency: 8 };
    expect(emptyConfig).toBeDefined();
    expect(partialConfig.maxConcurrency).toBe(8);
  });

  it('TaskOptions has correct structure', () => {
    const options: TaskOptions = {
      priority: 1,
      timeout: 30000,
      parentSessionId: 'session-123',
      autoCheckpoint: true,
    };
    expect(options.priority).toBe(1);
  });

  it('TaskQueueHandle has correct structure', () => {
    const handle: TaskQueueHandle = {
      taskId: 'task-123',
      status: 'running',
      progress: 0.5,
      result: { data: 'test' },
      error: undefined,
      on: () => {},
      cancel: () => {},
    };
    expect(handle.taskId).toBe('task-123');
    expect(handle.status).toBe('running');
  });

  it('TaskQueue interface can be implemented', () => {
    const mockQueue: TaskQueue = {
      enqueue: async () => ({
        taskId: 'test',
        status: 'pending',
        on: () => {},
        cancel: () => {},
      }),
      getStatus: async () => 'completed',
      getResult: async () => ({ data: 'result' }),
      cancel: async () => {},
      resume: async () => ({
        taskId: 'test',
        status: 'running',
        on: () => {},
        cancel: () => {},
      }),
      list: async () => [],
    };
    expect(mockQueue).toBeDefined();
  });
});
