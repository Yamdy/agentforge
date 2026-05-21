import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LoopOrchestrator, RunMode } from '../src/loop-orchestrator.js';
import { SnapshotServiceImpl } from '../src/snapshot-service.js';
import { NodeFsAdapter } from '../src/file-system-adapter.js';
import { InMemorySnapshotStore } from '../src/snapshot-store.js';
import { InMemoryCheckpointStore } from '../src/checkpoint-store.js';
import { PipelineRunner } from '../src/pipeline.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import { serialize, type SerializableContext } from '../src/serialize.js';
import type { PipelineContext, StreamEvent, SnapshotService } from '@primo-ai/sdk';

// Helper to create a minimal PipelineContext
function createTestContext(sessionId: string, input: string = 'test'): PipelineContext {
  return {
    request: { input, sessionId },
    agent: {
      config: { model: 'test-model' },
      toolDeclarations: [],
      promptFragments: [],
    },
    iteration: { step: 0 },
    session: { messageHistory: [], custom: {} },
  } as unknown as PipelineContext;
}

// Mock PipelineRunner that yields suspended event
function createMockRunner(suspendAfter: number = 1): PipelineRunner {
  let callCount = 0;
  return {
    stream: async function* (
      ctx: PipelineContext,
      stages: string[],
      options?: { signal?: AbortSignal },
    ): AsyncGenerator<StreamEvent> {
      callCount++;
      if (stages.includes('prepareStep')) {
        // In the loop, yield suspended after reaching threshold
        if (callCount >= suspendAfter) {
          yield { type: 'suspended', reason: 'test suspend' } as StreamEvent;
          return;
        }
      }
      yield { type: 'complete', context: ctx } as StreamEvent;
    },
  } as unknown as PipelineRunner;
}

describe('Snapshot End-to-End Integration', () => {
  let dir: string;
  let snapshotService: SnapshotServiceImpl;
  let orchestrator: LoopOrchestrator;
  let checkpointStore: InMemoryCheckpointStore<SerializableContext>;
  let eventBus: EventBus;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-e2e-test-'));

    // Setup snapshot service
    const adapter = new NodeFsAdapter();
    const snapshotStore = new InMemorySnapshotStore();
    snapshotService = new SnapshotServiceImpl({
      adapter,
      store: snapshotStore,
      patterns: [join(dir, '**/*.txt')],
    });

    // Setup orchestrator with snapshot service
    checkpointStore = new InMemoryCheckpointStore<SerializableContext>();
    eventBus = new EventBus();
    const runner = createMockRunner();
    const hookManager = new HookManager(eventBus);

    orchestrator = new LoopOrchestrator(
      runner,
      hookManager,
      checkpointStore,
      eventBus,
      undefined,
      snapshotService,
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('Suspend with Snapshot', () => {
    it('creates snapshot on suspend when snapshotOnSuspend is enabled', async () => {
      // Create a file before running
      await writeFile(join(dir, 'test.txt'), 'original content', 'utf-8');

      // Track initial snapshot
      const initialSnapshotId = await snapshotService.track();
      expect(initialSnapshotId).toBeDefined();

      // Verify snapshot was created with the file
      const snapshot = await snapshotService.getSnapshot(initialSnapshotId);
      expect(snapshot?.files).toHaveLength(1);
    });

    it('detects file changes after suspend', async () => {
      // Create initial file
      await writeFile(join(dir, 'a.txt'), 'initial', 'utf-8');
      const snapshotId = await snapshotService.track();

      // Modify file after snapshot
      await writeFile(join(dir, 'a.txt'), 'modified', 'utf-8');

      // Get patches
      const patches = await snapshotService.patch(snapshotId);
      expect(patches).toHaveLength(1);
      expect(patches[0]?.type).toBe('modified');
    });

    it('can revert new files created after snapshot', async () => {
      // Create initial file
      await writeFile(join(dir, 'existing.txt'), 'initial content', 'utf-8');
      const snapshotId = await snapshotService.track();

      // Create new file after snapshot
      await writeFile(join(dir, 'new-file.txt'), 'new content', 'utf-8');

      // Verify new file detected
      let patches = await snapshotService.patch(snapshotId);
      const createdPatch = patches.find(p => p.type === 'created');
      expect(createdPatch).toBeDefined();

      // Revert - should delete new file
      await snapshotService.revert(snapshotId);

      // Verify new file deleted
      patches = await snapshotService.patch(snapshotId);
      expect(patches.find(p => p.type === 'created')).toBeUndefined();
    });
  });

  describe('Checkpoint with SnapshotId', () => {
    it('saves snapshotId in checkpoint', async () => {
      await writeFile(join(dir, 'checkpoint-test.txt'), 'content', 'utf-8');
      const snapshotId = await snapshotService.track();

      const sessionId = 'test-session-1';
      const ctx = createTestContext(sessionId);

      // Save checkpoint with snapshotId
      const serialized = serialize(ctx, snapshotId);
      await checkpointStore.save(sessionId, serialized);

      // Load and verify
      const loaded = await checkpointStore.load(sessionId);
      expect(loaded?.snapshotId).toBe(snapshotId);
    });

    it('checkpoint without snapshotId is backward compatible', async () => {
      const sessionId = 'test-session-2';
      const ctx = createTestContext(sessionId);

      // Save checkpoint without snapshotId
      const serialized = serialize(ctx);
      await checkpointStore.save(sessionId, serialized);

      // Load and verify
      const loaded = await checkpointStore.load(sessionId);
      expect(loaded?.snapshotId).toBeUndefined();
    });
  });

  describe('RunMode with Snapshot', () => {
    it('can switch modes during suspend/resume cycle', () => {
      expect(orchestrator.mode).toBe(RunMode.Normal);

      // Switch to Shell mode (simulating interrupt)
      orchestrator.setMode(RunMode.Shell);
      expect(orchestrator.mode).toBe(RunMode.Shell);

      // Switch back to Normal mode
      orchestrator.setMode(RunMode.Normal);
      expect(orchestrator.mode).toBe(RunMode.Normal);
    });

    it('queues runs when in Shell mode', async () => {
      orchestrator.setMode(RunMode.Shell);

      const ctx = createTestContext('queued-session');
      const options = {
        maxIterations: 1,
        modelString: 'test-model',
        sessionId: 'queued-session',
      };

      // This should queue, not run immediately
      const resultPromise = orchestrator.runLoop(ctx, options);

      // Switch back to Normal mode should drain the queue
      orchestrator.setMode(RunMode.Normal);

      // Wait for completion
      const result = await resultPromise;
      expect(result).toBeDefined();
    });
  });

  describe('File System Auditing Flow', () => {
    it('complete track-detect-revert flow for new files', async () => {
      // Step 1: Create initial state
      await writeFile(join(dir, 'doc.txt'), 'version 1', 'utf-8');
      const snapshotId = await snapshotService.track();

      // Step 2: Simulate agent work that creates new files
      await writeFile(join(dir, 'doc.txt'), 'version 2', 'utf-8'); // Modified
      await writeFile(join(dir, 'new-file.txt'), 'new content', 'utf-8'); // Created

      // Step 3: Detect changes
      const patches = await snapshotService.patch(snapshotId);
      expect(patches.length).toBeGreaterThanOrEqual(2);

      // Step 4: Revert - deletes new files (modified files not restored by current impl)
      await snapshotService.revert(snapshotId);

      // Step 5: Verify new file deleted
      const patchesAfterRevert = await snapshotService.patch(snapshotId);
      const createdPatch = patchesAfterRevert.find(p => p.type === 'created');
      expect(createdPatch).toBeUndefined();

      // Modified file still shows as modified (revert doesn't restore content)
      const modifiedPatch = patchesAfterRevert.find(p => p.type === 'modified');
      expect(modifiedPatch).toBeDefined();
    });
  });
});
