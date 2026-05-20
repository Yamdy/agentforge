/**
 * Auto Checkpoint Plugin
 *
 * Automatically saves checkpoints at each iteration for task recovery.
 */
import type { PluginRegistration, ProcessorContext } from '@primo-ai/sdk';
import { serialize } from '../serialize.js';
import type { CheckpointStore } from '@primo-ai/sdk';

export function autoCheckpointPlugin(
  taskId: string,
  store: CheckpointStore,
): PluginRegistration {
  return {
    processors: [
      {
        stage: 'evaluateIteration',
        execute: async (pCtx: ProcessorContext) => {
          const ctx = pCtx.state;
          const checkpoint = serialize(ctx);
          await store.save(taskId, checkpoint);
        },
      },
    ],
  };
}
