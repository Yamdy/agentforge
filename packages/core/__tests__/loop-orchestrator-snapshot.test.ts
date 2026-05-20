import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
import type { SerializableContext } from '../src/serialize.js';

describe('LoopOrchestrator with SnapshotService', () => {
  let dir: string;
  let orchestrator: LoopOrchestrator;
  let snapshotService: SnapshotServiceImpl;
  let checkpointStore: InMemoryCheckpointStore<SerializableContext>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loop-snapshot-test-'));

    const adapter = new NodeFsAdapter();
    const snapshotStore = new InMemorySnapshotStore();
    snapshotService = new SnapshotServiceImpl({
      adapter,
      store: snapshotStore,
      patterns: [join(dir, '**/*.txt')],
    });

    checkpointStore = new InMemoryCheckpointStore<SerializableContext>();

    const eventBus = new EventBus();
    const runner = { stream: async function* () {} } as unknown as PipelineRunner;
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

  describe('SnapshotService integration', () => {
    it('accepts optional snapshotService in constructor', () => {
      expect(orchestrator).toBeDefined();
    });

    it('exposes snapshotService capability', () => {
      expect((orchestrator as unknown as Record<string, unknown>).snapshotService).toBeDefined();
    });
  });

  describe('RunMode with snapshot', () => {
    it('can switch to Shell mode for interruption', () => {
      expect(orchestrator.mode).toBe(RunMode.Normal);
      orchestrator.setMode(RunMode.Shell);
      expect(orchestrator.mode).toBe(RunMode.Shell);
    });
  });
});
