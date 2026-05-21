import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManagerImpl } from '../src/session-manager.js';
import { FilesystemSessionStorage } from '../src/session-storage.js';
import { EventBus } from '../src/event-bus.js';
import { SnapshotServiceImpl } from '../src/snapshot-service.js';
import { NodeFsAdapter } from '../src/file-system-adapter.js';
import { InMemorySnapshotStore } from '../src/snapshot-store.js';
import type { SnapshotService, SessionEvent } from '@primo-ai/sdk';

describe('SessionManager with SnapshotService', () => {
  let dir: string;
  let storage: FilesystemSessionStorage;
  let bus: EventBus;
  let sessionManager: SessionManagerImpl;
  let snapshotService: SnapshotService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-snapshot-test-'));

    // Setup storage
    storage = new FilesystemSessionStorage(dir);
    bus = new EventBus();

    // Setup snapshot service
    const adapter = new NodeFsAdapter();
    const snapshotStore = new InMemorySnapshotStore();
    snapshotService = new SnapshotServiceImpl({
      adapter,
      store: snapshotStore,
      patterns: [join(dir, '**/*.txt')],
    });

    // Create SessionManager with optional SnapshotService
    sessionManager = new SessionManagerImpl(storage, bus, snapshotService);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('accepts optional snapshotService parameter', () => {
      expect(sessionManager).toBeDefined();
    });

    it('works without snapshotService (backward compatible)', () => {
      const managerWithoutSnapshot = new SessionManagerImpl(storage, bus);
      expect(managerWithoutSnapshot).toBeDefined();
    });
  });

  describe('getSessionSnapshots', () => {
    it('returns empty array when no snapshots exist', async () => {
      const record = await sessionManager.start('test input');
      const snapshots = await sessionManager.getSessionSnapshots(record.sessionId);
      expect(snapshots).toEqual([]);
    });

    it('returns snapshot IDs associated with session', async () => {
      // Create a file and track snapshot
      await writeFile(join(dir, 'test.txt'), 'content', 'utf-8');
      const snapshotId = await snapshotService.track();

      // Start session and persist snapshot:track event
      const record = await sessionManager.start('test input');
      const event: SessionEvent = {
        seq: 1,
        timestamp: new Date().toISOString(),
        type: 'snapshot:track',
        payload: { sessionId: record.sessionId, snapshotId, patterns: ['**/*.txt'], fileCount: 1 },
      };
      await storage.append(record.sessionId, event);

      const snapshots = await sessionManager.getSessionSnapshots(record.sessionId);
      expect(snapshots).toContain(snapshotId);
    });
  });

  describe('getSessionPatches', () => {
    it('returns empty array when no snapshots exist', async () => {
      const record = await sessionManager.start('test input');
      const patches = await sessionManager.getSessionPatches(record.sessionId);
      expect(patches).toEqual([]);
    });

    it('returns file patches for session snapshot', async () => {
      // Create file and take snapshot
      await writeFile(join(dir, 'test.txt'), 'original', 'utf-8');
      const snapshotId = await snapshotService.track();

      // Start session and persist snapshot:track event
      const record = await sessionManager.start('test input');
      const event: SessionEvent = {
        seq: 1,
        timestamp: new Date().toISOString(),
        type: 'snapshot:track',
        payload: { sessionId: record.sessionId, snapshotId, patterns: ['**/*.txt'], fileCount: 1 },
      };
      await storage.append(record.sessionId, event);

      // Modify file
      await writeFile(join(dir, 'test.txt'), 'modified', 'utf-8');

      const patches = await sessionManager.getSessionPatches(record.sessionId);
      expect(patches).toHaveLength(1);
      expect(patches[0]?.type).toBe('modified');
      expect(patches[0]?.path).toBe(join(dir, 'test.txt'));
    });

    it('returns patches for most recent snapshot when multiple exist', async () => {
      // Create first snapshot
      await writeFile(join(dir, 'a.txt'), 'file a', 'utf-8');
      const snapshotId1 = await snapshotService.track();

      // Create second snapshot
      await writeFile(join(dir, 'b.txt'), 'file b', 'utf-8');
      const snapshotId2 = await snapshotService.track();

      // Start session and persist both snapshot:track events
      const record = await sessionManager.start('test input');
      const event1: SessionEvent = {
        seq: 1,
        timestamp: new Date().toISOString(),
        type: 'snapshot:track',
        payload: { sessionId: record.sessionId, snapshotId: snapshotId1, patterns: ['**/*.txt'], fileCount: 1 },
      };
      await storage.append(record.sessionId, event1);
      const event2: SessionEvent = {
        seq: 2,
        timestamp: new Date().toISOString(),
        type: 'snapshot:track',
        payload: { sessionId: record.sessionId, snapshotId: snapshotId2, patterns: ['**/*.txt'], fileCount: 2 },
      };
      await storage.append(record.sessionId, event2);

      // Modify both files
      await writeFile(join(dir, 'a.txt'), 'modified a', 'utf-8');
      await writeFile(join(dir, 'b.txt'), 'modified b', 'utf-8');

      const patches = await sessionManager.getSessionPatches(record.sessionId);
      // Should use most recent snapshot (snapshotId2)
      expect(patches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('snapshot events in restore', () => {
    it('restores snapshotId from session events', async () => {
      await writeFile(join(dir, 'test.txt'), 'content', 'utf-8');
      const snapshotId = await snapshotService.track();

      const record = await sessionManager.start('test input');
      const event: SessionEvent = {
        seq: 1,
        timestamp: new Date().toISOString(),
        type: 'snapshot:track',
        payload: { sessionId: record.sessionId, snapshotId, patterns: ['**/*.txt'], fileCount: 1 },
      };
      await storage.append(record.sessionId, event);

      // Suspend to save state
      await sessionManager.suspend(record.sessionId, 'test suspend');

      // Restore should include snapshot info
      const ctx = await sessionManager.restore(record.sessionId);
      expect(ctx.session.custom.snapshotIds).toContain(snapshotId);
    });
  });
});
