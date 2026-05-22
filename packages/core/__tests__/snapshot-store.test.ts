import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemorySnapshotStore, JsonlSnapshotStore } from '../src/snapshot-store.js';
import type { Snapshot, FileSnapshot } from '@primo-ai/sdk';

function makeSnapshot(overrides?: Partial<Snapshot>): Snapshot {
  return {
    id: 'snap-001',
    createdAt: '2026-05-21T10:00:00.000Z',
    files: [
      { path: '/test/file1.txt', hash: 'hash1' },
      { path: '/test/file2.txt', hash: 'hash2' },
    ],
    hasContent: false,
    ...overrides,
  };
}

describe('InMemorySnapshotStore', () => {
  let store: InMemorySnapshotStore;

  beforeEach(() => {
    store = new InMemorySnapshotStore();
  });

  it('save and load round-trip', async () => {
    const snapshot = makeSnapshot();

    await store.save(snapshot);
    const loaded = await store.load(snapshot.id);

    expect(loaded).toEqual(snapshot);
  });

  it('load returns undefined for missing snapshot', async () => {
    expect(await store.load('nonexistent')).toBeUndefined();
  });

  it('delete removes snapshot', async () => {
    const snapshot = makeSnapshot();
    await store.save(snapshot);
    await store.delete(snapshot.id);
    expect(await store.load(snapshot.id)).toBeUndefined();
  });

  it('list returns all snapshot IDs', async () => {
    await store.save(makeSnapshot({ id: 'snap-001' }));
    await store.save(makeSnapshot({ id: 'snap-002' }));

    const ids = await store.list();
    expect(ids.sort()).toEqual(['snap-001', 'snap-002']);
  });
});

describe('JsonlSnapshotStore', () => {
  let dir: string;
  let store: JsonlSnapshotStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-store-test-'));
    store = new JsonlSnapshotStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('save and load round-trip', async () => {
    const snapshot = makeSnapshot();

    await store.save(snapshot);
    const loaded = await store.load(snapshot.id);

    expect(loaded).toEqual(snapshot);
  });

  it('load returns undefined for missing snapshot', async () => {
    expect(await store.load('nonexistent')).toBeUndefined();
  });

  it('delete removes file', async () => {
    const snapshot = makeSnapshot();
    await store.save(snapshot);
    await store.delete(snapshot.id);
    expect(await store.load(snapshot.id)).toBeUndefined();
  });

  it('list returns snapshot IDs', async () => {
    await store.save(makeSnapshot({ id: 'snap-001' }));
    await store.save(makeSnapshot({ id: 'snap-002' }));

    const ids = await store.list();
    expect(ids.sort()).toEqual(['snap-001', 'snap-002']);
  });

  it('survives process restart (re-read from disk)', async () => {
    const snapshot = makeSnapshot({ id: 'snap-abc', files: [{ path: '/x.txt', hash: 'abc123' }] });
    await store.save(snapshot);

    // Simulate restart: new store instance pointing to same directory
    const newStore = new JsonlSnapshotStore(dir);
    const loaded = await newStore.load('snap-abc');

    expect(loaded).toEqual(snapshot);
  });

  it('persists files array correctly', async () => {
    const files: FileSnapshot[] = [
      { path: '/a.txt', hash: 'h1' },
      { path: '/b.txt', hash: 'h2' },
      { path: '/c.txt', hash: 'h3' },
    ];
    const snapshot = makeSnapshot({ id: 'snap-many', files });

    await store.save(snapshot);
    const loaded = await store.load('snap-many');

    expect(loaded?.files).toHaveLength(3);
    expect(loaded?.files).toEqual(files);
  });
});
