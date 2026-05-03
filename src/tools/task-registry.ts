/**
 * TaskRegistry — singleton registry for background tasks.
 *
 * Tracks background processes spawned by the bash tool and provides
 * lifecycle management (register, get, list, remove, kill).
 *
 * Stores ChildProcess references (not just PIDs) so that kill()
 * uses child.kill() — which handles cross-platform correctly and
 * avoids PID-reuse races.
 */

import type { ChildProcess } from 'child_process';

// ============================================================
// Types
// ============================================================

interface TaskEntry {
  child: ChildProcess;
  command: string;
  startTime: number;
}

// ============================================================
// TaskRegistry
// ============================================================

export class TaskRegistry {
  private tasks: Map<string, TaskEntry> = new Map();

  /**
   * Register a background task with its ChildProcess and command.
   */
  register(taskId: string, child: ChildProcess, command: string): void {
    this.tasks.set(taskId, {
      child,
      command,
      startTime: Date.now(),
    });
  }

  /**
   * Get task info by ID. Returns null if not found.
   */
  get(taskId: string): TaskEntry | null {
    return this.tasks.get(taskId) ?? null;
  }

  /**
   * Remove a task from the registry.
   */
  remove(taskId: string): void {
    this.tasks.delete(taskId);
  }

  /**
   * List all currently registered task IDs.
   */
  list(): string[] {
    return Array.from(this.tasks.keys());
  }

  /**
   * Kill a background task.
   *
   * Uses child.kill() on the stored ChildProcess reference:
   * - Sends SIGTERM first. If the process doesn't exit within 2 seconds,
   *   sends SIGKILL as a forceful fallback.
   * - On Windows, child.kill() maps to TerminateProcess.
   * - Avoids PID-reuse race by holding the process reference directly.
   *
   * Returns a result object indicating success/failure.
   */
  kill(taskId: string): Promise<{ success: boolean; message: string }> {
    return new Promise(resolve => {
      const entry = this.tasks.get(taskId);
      if (!entry) {
        resolve({ success: false, message: `Task "${taskId}" not found` });
        return;
      }

      const { child } = entry;
      let settled = false;

      const finish = (success: boolean, message: string): void => {
        if (settled) return;
        settled = true;
        resolve({ success, message });
      };

      // child.kill() returns true if signal was delivered, false if process already exited
      const sigtermDelivered = child.kill('SIGTERM');

      if (!sigtermDelivered) {
        finish(false, `Task "${taskId}" (PID ${child.pid}) could not be killed: process not found`);
        return;
      }

      // Set up SIGKILL fallback after 2s
      const killTimeout = setTimeout(() => {
        clearInterval(checkInterval);
        child.kill('SIGKILL');
        finish(true, `Task "${taskId}" (PID ${child.pid}) forcefully killed (SIGKILL)`);
      }, 2000);

      // Check if process exited quickly after SIGTERM
      const checkInterval = setInterval(() => {
        if (child.exitCode !== null || child.killed) {
          // Process is already dead
          clearInterval(checkInterval);
          clearTimeout(killTimeout);
          finish(true, `Task "${taskId}" (PID ${child.pid}) killed`);
        }
      }, 200);
    });
  }
}

// ============================================================
// Singleton Instance
// ============================================================

export const taskRegistry = new TaskRegistry();
