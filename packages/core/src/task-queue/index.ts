/**
 * TaskQueue Module
 *
 * Long-running task management with:
 * - Concurrent execution control
 * - Task status tracking
 * - Event emission
 * - Checkpoint-based recovery
 */

export { TaskQueueImpl } from './queue.js';
export { autoCheckpointPlugin } from './checkpoint-plugin.js';
export { TaskNotificationManager } from './notification.js';
