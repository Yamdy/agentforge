import { describe, it, expect, beforeEach } from 'vitest';
import { CheckpointManager } from '../../src/session/checkpoint.js';
import type { SessionMessage } from '../../src/session/types.js';

describe('CheckpointManager', () => {
  let manager: CheckpointManager;
  let sessionId: string;

  beforeEach(async () => {
    manager = new CheckpointManager();
    await manager.init();
    // 使用唯一的 sessionId 避免测试间干扰
    sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  });

  it('should create checkpoint', async () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'hello', timestamp: Date.now() },
    ];

    const checkpoint = await manager.create(sessionId, 1, {
      messages,
      toolCalls: [],
      state: { status: 'running', step: 1 },
    });

    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.sessionId).toBe(sessionId);
    expect(checkpoint.stepIndex).toBe(1);
    expect(checkpoint.messages).toHaveLength(1);
  });

  it('should list checkpoints', async () => {
    await manager.create(sessionId, 1, {
      messages: [],
      toolCalls: [],
      state: { status: 'running', step: 1 },
    });
    await manager.create(sessionId, 2, {
      messages: [],
      toolCalls: [],
      state: { status: 'running', step: 2 },
    });

    const checkpoints = await manager.list(sessionId);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].stepIndex).toBe(2); // 最新的在前
  });

  it('should restore checkpoint', async () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: 'test message', timestamp: Date.now() },
    ];

    const checkpoint = await manager.create(sessionId, 1, {
      messages,
      toolCalls: [],
      state: { status: 'running', step: 1 },
    });

    const restored = await manager.restore(checkpoint.id);
    expect(restored).toBeDefined();
    expect(restored?.messages).toHaveLength(1);
    expect(restored?.messages[0].content).toBe('test message');
  });

  it('should delete checkpoint', async () => {
    const checkpoint = await manager.create(sessionId, 1, {
      messages: [],
      toolCalls: [],
      state: { status: 'running', step: 1 },
    });

    const deleted = await manager.delete(checkpoint.id);
    expect(deleted).toBe(true);

    const restored = await manager.restore(checkpoint.id);
    expect(restored).toBeNull();
  });
});
