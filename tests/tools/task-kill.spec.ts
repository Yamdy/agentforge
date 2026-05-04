/**
 * TaskKillTool + TaskRegistry Tests
 *
 * Tests for background task registration, listing, and killing.
 * Uses Node.js built-in child_process (spawn) for real process testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { platform } from 'os';
import { spawn } from 'child_process';
import { taskRegistry } from '../../src/tools/task-registry.js';
import { createTaskKillTool } from '../../src/tools/task-kill.js';
import type { ToolDefinition } from '../../src/core/interfaces.js';
import type { ChildProcess } from 'child_process';

// ============================================================
// Platform helpers
// ============================================================

/**
 * Check if a process is dead (no longer running).
 * On Windows, child.killed may not be set reliably after process.kill().
 * Use process.kill(pid, 0) as a cross-platform alive check.
 * Signal 0 does not kill — it just tests existence.
 */
function isProcessDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false; // Process still alive
  } catch {
    return true; // Process not found or no permission
  }
}

// ============================================================
// Test Helpers
// ============================================================

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

/**
 * Create a minimal ChildProcess mock for basic registry tests.
 * The real implementation only accesses .pid, .kill(), .exitCode, .killed.
 */
function mockChildProcess(overrides?: Partial<ChildProcess>): ChildProcess {
  return {
    pid: 12345,
    kill: vi.fn().mockReturnValue(true),
    exitCode: null,
    killed: false,
    ...overrides,
  } as unknown as ChildProcess;
}

// ============================================================
// TaskRegistry Tests
// ============================================================

describe('TaskRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    for (const taskId of taskRegistry.list()) {
      taskRegistry.remove(taskId);
    }
  });

  afterEach(() => {
    // Clean up any remaining tasks
    for (const taskId of taskRegistry.list()) {
      taskRegistry.remove(taskId);
    }
  });

  it('should register a task and retrieve it', () => {
    const child = mockChildProcess({ pid: 12345 });
    taskRegistry.register('task-001', child, 'node test.js');
    const info = taskRegistry.get('task-001');
    expect(info).not.toBeNull();
    expect(info!.child.pid).toBe(12345);
    expect(info!.command).toBe('node test.js');
    expect(info!.startTime).toBeTypeOf('number');
  });

  it('should return null for unknown taskId', () => {
    const info = taskRegistry.get('nonexistent');
    expect(info).toBeNull();
  });

  it('should list all registered tasks', () => {
    taskRegistry.register('task-a', mockChildProcess({ pid: 100 }), 'cmd-a');
    taskRegistry.register('task-b', mockChildProcess({ pid: 200 }), 'cmd-b');
    taskRegistry.register('task-c', mockChildProcess({ pid: 300 }), 'cmd-c');

    const ids = taskRegistry.list();
    expect(ids).toHaveLength(3);
    expect(ids).toContain('task-a');
    expect(ids).toContain('task-b');
    expect(ids).toContain('task-c');
  });

  it('should remove a task from registry', () => {
    taskRegistry.register('task-001', mockChildProcess({ pid: 12345 }), 'node test.js');
    expect(taskRegistry.get('task-001')).not.toBeNull();

    taskRegistry.remove('task-001');
    expect(taskRegistry.get('task-001')).toBeNull();
  });

  it('should kill a running background process (real process)', async () => {
    // Spawn a long-running process via the registry kill method
    const child = spawn('node', ['-e', 'setTimeout(()=>{},60000)'], {
      stdio: 'ignore',
      detached: false,
    });

    const taskId = 'kill-test-task';
    taskRegistry.register(taskId, child, 'node -e setTimeout(...)');

    // Verify process is alive
    expect(isProcessDead(child.pid!)).toBe(false);

    // Kill via registry — uses child.kill() internally
    const result = await taskRegistry.kill(taskId);
    expect(result.success).toBe(true);

    // Give OS time to reap the process
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(isProcessDead(child.pid!)).toBe(true);

    // Task should still be in registry (kill doesn't remove, bash.ts cleanup does)
    // But the task itself should be killable
  });

  it('should return not-found for kill on unknown taskId', async () => {
    const result = await taskRegistry.kill('nonexistent');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('should handle remove of non-existent task gracefully', () => {
    // Should not throw
    taskRegistry.remove('nonexistent');
  });

  it('should handle kill with already-dead process gracefully', async () => {
    // Register a task whose child.kill() returns false (process already dead)
    const child = mockChildProcess({ pid: 99999, kill: vi.fn().mockReturnValue(false) });
    taskRegistry.register('ghost-task', child, 'nonexistent cmd');

    // Kill should detect dead process via kill() return value and handle gracefully
    const result = await taskRegistry.kill('ghost-task');
    // Should fail with a message about process not found
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('message');
    expect(result.success).toBe(false);
  });
});

// ============================================================
// TaskKillTool Tests
// ============================================================

describe('createTaskKillTool', () => {
  let tools: ToolDefinition[];
  let killTool: ToolDefinition;

  beforeEach(() => {
    tools = createTaskKillTool();
    killTool = getTool(tools, 'task_kill');

    // Clear registry before each test
    for (const taskId of taskRegistry.list()) {
      taskRegistry.remove(taskId);
    }
  });

  afterEach(() => {
    for (const taskId of taskRegistry.list()) {
      taskRegistry.remove(taskId);
    }
  });

  it('should create a tool with name "task_kill"', () => {
    expect(tools).toHaveLength(1);
    expect(killTool.name).toBe('task_kill');
  });

  it('should have a description', () => {
    expect(killTool.description).toBeTruthy();
    expect(killTool.description.length).toBeGreaterThan(0);
  });

  it('should have Zod parameters with task_id field', () => {
    const params = killTool.parameters as { parse: (val: unknown) => unknown };
    // Valid parse
    const parsed = params.parse({ task_id: 'test-123' });
    expect(parsed).toHaveProperty('task_id', 'test-123');
  });

  it('should reject missing task_id', async () => {
    const result = await killTool.execute({});
    expect(result).toContain('Error');
  });

  it('should reject invalid task_id type (non-string)', async () => {
    const result = await killTool.execute({ task_id: 12345 });
    expect(result).toContain('Error');
  });

  it('should return not-found for unknown taskId', async () => {
    const result = await killTool.execute({ task_id: 'unknown-task' });
    expect(result).toContain('not found');
  });

  it('should kill a registered task and return success message', async () => {
    const child = spawn('node', ['-e', 'setTimeout(()=>{},60000)'], {
      stdio: 'ignore',
      detached: false,
    });

    const taskId = 'tool-kill-test';
    taskRegistry.register(taskId, child, 'node -e setTimeout(...)');

    const result = await killTool.execute({ task_id: taskId });
    expect(result).toContain('killed');
    expect(result).toContain(taskId);

    // Process should be dead
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(isProcessDead(child.pid!)).toBe(true);
  });

  it('should handle killing an already-dead task gracefully', async () => {
    // Register a task with a known-good entry, but we'll verify the tool
    // handles the case where the process is already gone
    const child = spawn('node', ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
      detached: false,
    });

    const taskId = 'already-dead-task';
    const pid = child.pid!;
    taskRegistry.register(taskId, child, 'node -e process.exit(0)');

    // Wait for process to exit naturally
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(isProcessDead(pid)).toBe(true);

    // Now try to kill it - should handle gracefully
    const result = await killTool.execute({ task_id: taskId });
    // Should return some message (killed or error, but not crash)
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Integration: Registry + Tool workflow
// ============================================================

describe('TaskRegistry + TaskKillTool integration', () => {
  beforeEach(() => {
    for (const taskId of taskRegistry.list()) {
      taskRegistry.remove(taskId);
    }
  });

  afterEach(() => {
    for (const taskId of taskRegistry.list()) {
      taskRegistry.remove(taskId);
    }
  });

  it('should support full lifecycle: register → list → kill', async () => {
    const child = spawn('node', ['-e', 'setTimeout(()=>{},60000)'], {
      stdio: 'ignore',
      detached: false,
    });

    const taskId = 'lifecycle-test';
    taskRegistry.register(taskId, child, 'node -e setTimeout(...)');

    // List should contain our task
    const ids = taskRegistry.list();
    expect(ids).toContain(taskId);

    // Kill via tool
    const killTools = createTaskKillTool();
    const killTool = getTool(killTools, 'task_kill');
    const result = await killTool.execute({ task_id: taskId });
    expect(result).toContain('killed');

    // Process should be dead
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(isProcessDead(child.pid!)).toBe(true);

    // Info should still be retrievable (registry doesn't auto-remove on kill)
    const info = taskRegistry.get(taskId);
    expect(info).not.toBeNull();
  });
});
