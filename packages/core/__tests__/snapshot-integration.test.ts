import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SnapshotServiceImpl } from '../src/snapshot-service.js';
import { NodeFsAdapter } from '../src/file-system-adapter.js';
import { InMemorySnapshotStore } from '../src/snapshot-store.js';
import { InMemoryCheckpointStore } from '../src/checkpoint-store.js';
import type { SessionEvent } from '@primo-ai/sdk';
import type { SerializableContext } from '../src/serialize.js';

describe('Snapshot Integration', () => {
  let dir: string;
  let snapshotService: SnapshotServiceImpl;
  let checkpointStore: InMemoryCheckpointStore<SerializableContext>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-integration-test-'));
    const adapter = new NodeFsAdapter();
    const snapshotStore = new InMemorySnapshotStore();
    snapshotService = new SnapshotServiceImpl({
      adapter,
      store: snapshotStore,
      patterns: [join(dir, '**/*.txt')],
    });
    checkpointStore = new InMemoryCheckpointStore<SerializableContext>();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('SessionEvent types', () => {
    it('supports snapshot:track event type', () => {
      const event: SessionEvent = {
        seq: 1,
        timestamp: new Date().toISOString(),
        type: 'snapshot:track',
        payload: { snapshotId: 'snap-123', patterns: ['**/*.ts'], fileCount: 5 },
      };
      expect(event.type).toBe('snapshot:track');
    });

    it('supports snapshot:patch event type', () => {
      const event: SessionEvent = {
        seq: 2,
        timestamp: new Date().toISOString(),
        type: 'snapshot:patch',
        payload: { snapshotId: 'snap-123', patches: [] },
      };
      expect(event.type).toBe('snapshot:patch');
    });

    it('supports snapshot:revert event type', () => {
      const event: SessionEvent = {
        seq: 3,
        timestamp: new Date().toISOString(),
        type: 'snapshot:revert',
        payload: { snapshotId: 'snap-123', revertedCount: 2 },
      };
      expect(event.type).toBe('snapshot:revert');
    });
  });

  describe('Checkpoint with snapshotId', () => {
    it('stores snapshotId in checkpoint', async () => {
      await writeFile(join(dir, 'test.txt'), 'content', 'utf-8');
      const snapshotId = await snapshotService.track();

      // Store checkpoint with snapshot reference
      const mockContext = {
        request: { input: 'test', sessionId: 'session-1' },
        agent: { config: {}, toolDeclarations: [], promptFragments: [] },
        iteration: { step: 0 },
        session: { messageHistory: [], custom: {} },
        snapshotId,
      } as unknown as SerializableContext;

      await checkpointStore.save('session-1', mockContext);

      const checkpoint = await checkpointStore.load('session-1');
      expect(checkpoint?.snapshotId).toBe(snapshotId);
    });

    it('checkpoint without snapshotId works (backward compatible)', async () => {
      const mockContext = {
        request: { input: 'test', sessionId: 'session-2' },
        agent: { config: {}, toolDeclarations: [], promptFragments: [] },
        iteration: { step: 0 },
        session: { messageHistory: [], custom: {} },
      } as unknown as SerializableContext;

      await checkpointStore.save('session-2', mockContext);

      const checkpoint = await checkpointStore.load('session-2');
      expect(checkpoint?.snapshotId).toBeUndefined();
    });
  });

  describe('Snapshot lifecycle', () => {
    it('creates snapshot on track()', async () => {
      await writeFile(join(dir, 'a.txt'), 'file a', 'utf-8');

      const snapshotId = await snapshotService.track();
      const snapshot = await snapshotService.getSnapshot(snapshotId);

      expect(snapshot?.files).toHaveLength(1);
      expect(snapshot?.files[0]?.path).toBe(join(dir, 'a.txt'));
    });

    it('detects changes after suspend point', async () => {
      await writeFile(join(dir, 'a.txt'), 'original', 'utf-8');
      const snapshotId = await snapshotService.track();

      // Modify file after snapshot
      await writeFile(join(dir, 'a.txt'), 'modified', 'utf-8');

      const patches = await snapshotService.patch(snapshotId);
      expect(patches).toHaveLength(1);
      expect(patches[0]?.type).toBe('modified');
    });

    it('can revert new files created during session', async () => {
      await writeFile(join(dir, 'a.txt'), 'existing', 'utf-8');
      const snapshotId = await snapshotService.track();

      // Create new file after snapshot
      await writeFile(join(dir, 'b.txt'), 'new file', 'utf-8');

      await snapshotService.revert(snapshotId);

      // b.txt should be deleted
      const snapshot = await snapshotService.getSnapshot(snapshotId);
      const patches = await snapshotService.patch(snapshotId);
      expect(patches).toHaveLength(0); // All reverted
    });
  });
});
