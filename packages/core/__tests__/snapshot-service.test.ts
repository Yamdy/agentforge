import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SnapshotServiceImpl } from '../src/snapshot-service.js';
import { NodeFsAdapter } from '../src/file-system-adapter.js';
import { InMemorySnapshotStore } from '../src/snapshot-store.js';

describe('SnapshotService', () => {
  let dir: string;
  let service: SnapshotServiceImpl;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-service-test-'));
    const adapter = new NodeFsAdapter();
    const store = new InMemorySnapshotStore();
    service = new SnapshotServiceImpl({
      adapter,
      store,
      patterns: [join(dir, '**/*.txt')],
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('track', () => {
    it('creates snapshot of matching files', async () => {
      await writeFile(join(dir, 'a.txt'), 'content a', 'utf-8');
      await writeFile(join(dir, 'b.txt'), 'content b', 'utf-8');

      const snapshotId = await service.track();

      expect(snapshotId).toBeDefined();
      expect(snapshotId).toMatch(/^snap-/);
    });

    it('snapshot includes file hashes', async () => {
      await writeFile(join(dir, 'test.txt'), 'hello', 'utf-8');

      const snapshotId = await service.track();
      const snapshot = await service.getSnapshot(snapshotId);

      expect(snapshot?.files).toHaveLength(1);
      expect(snapshot?.files[0]?.path).toBe(join(dir, 'test.txt'));
      // SHA-256 of "hello"
      expect(snapshot?.files[0]?.hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('ignores files not matching patterns', async () => {
      await writeFile(join(dir, 'a.txt'), 'txt file', 'utf-8');
      await writeFile(join(dir, 'b.md'), 'md file', 'utf-8');

      const snapshotId = await service.track();
      const snapshot = await service.getSnapshot(snapshotId);

      expect(snapshot?.files).toHaveLength(1);
      expect(snapshot?.files[0]?.path).toBe(join(dir, 'a.txt'));
    });

    it('tracks files in subdirectories', async () => {
      await mkdir(join(dir, 'sub'));
      await writeFile(join(dir, 'sub', 'nested.txt'), 'nested', 'utf-8');

      const snapshotId = await service.track();
      const snapshot = await service.getSnapshot(snapshotId);

      expect(snapshot?.files).toHaveLength(1);
      expect(snapshot?.files[0]?.path).toBe(join(dir, 'sub', 'nested.txt'));
    });
  });

  describe('patch', () => {
    it('returns empty array when no changes', async () => {
      await writeFile(join(dir, 'a.txt'), 'unchanged', 'utf-8');
      const snapshotId = await service.track();

      const patches = await service.patch(snapshotId);

      expect(patches).toEqual([]);
    });

    it('detects modified file', async () => {
      const filePath = join(dir, 'a.txt');
      await writeFile(filePath, 'original', 'utf-8');
      const snapshotId = await service.track();

      // Modify file
      await writeFile(filePath, 'modified', 'utf-8');

      const patches = await service.patch(snapshotId);

      expect(patches).toHaveLength(1);
      expect(patches[0]?.type).toBe('modified');
      expect(patches[0]?.path).toBe(filePath);
    });

    it('detects created file', async () => {
      await writeFile(join(dir, 'a.txt'), 'existing', 'utf-8');
      const snapshotId = await service.track();

      // Create new file
      await writeFile(join(dir, 'b.txt'), 'new file', 'utf-8');

      const patches = await service.patch(snapshotId);

      expect(patches).toHaveLength(1);
      expect(patches[0]?.type).toBe('created');
      expect(patches[0]?.path).toBe(join(dir, 'b.txt'));
    });

    it('detects deleted file', async () => {
      const filePath = join(dir, 'a.txt');
      await writeFile(filePath, 'to delete', 'utf-8');
      const snapshotId = await service.track();

      // Delete file
      await rm(filePath);

      const patches = await service.patch(snapshotId);

      expect(patches).toHaveLength(1);
      expect(patches[0]?.type).toBe('deleted');
      expect(patches[0]?.path).toBe(filePath);
    });

    it('detects multiple changes', async () => {
      await writeFile(join(dir, 'a.txt'), 'original a', 'utf-8');
      await writeFile(join(dir, 'b.txt'), 'original b', 'utf-8');
      const snapshotId = await service.track();

      // Modify one, delete one, create one
      await writeFile(join(dir, 'a.txt'), 'modified a', 'utf-8');
      await rm(join(dir, 'b.txt'));
      await writeFile(join(dir, 'c.txt'), 'new c', 'utf-8');

      const patches = await service.patch(snapshotId);

      expect(patches).toHaveLength(3);
      const types = patches.map(p => p.type).sort();
      expect(types).toEqual(['created', 'deleted', 'modified']);
    });
  });

  describe('revert', () => {
    it('deletes created file', async () => {
      await writeFile(join(dir, 'a.txt'), 'existing', 'utf-8');
      const snapshotId = await service.track();

      await writeFile(join(dir, 'b.txt'), 'new file', 'utf-8');
      await service.revert(snapshotId);

      await expect(readFile(join(dir, 'b.txt'))).rejects.toThrow();
    });

    it('handles multiple new files', async () => {
      await writeFile(join(dir, 'a.txt'), 'existing', 'utf-8');
      const snapshotId = await service.track();

      await writeFile(join(dir, 'b.txt'), 'new b', 'utf-8');
      await writeFile(join(dir, 'c.txt'), 'new c', 'utf-8');

      await service.revert(snapshotId);

      // b.txt and c.txt should be deleted
      await expect(readFile(join(dir, 'b.txt'))).rejects.toThrow();
      await expect(readFile(join(dir, 'c.txt'))).rejects.toThrow();
      // a.txt should still exist
      expect(await readFile(join(dir, 'a.txt'), 'utf-8')).toBe('existing');
    });

    // Note: Restoring modified/deleted files requires storing file content
    // in snapshots, which is a Phase 2 feature. For MVP, revert only deletes
    // newly created files.
    it.todo('restores modified file (requires content storage)');
    it.todo('restores deleted file (requires content storage)');
  });
});
