import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemEvictionStorage } from '../src/eviction/filesystem-storage.js';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('FilesystemEvictionStorage', () => {
  let storage: FilesystemEvictionStorage;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eviction-test-'));
    storage = new FilesystemEvictionStorage(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // store + retrieve round-trip
  // ---------------------------------------------------------------------------
  describe('store + retrieve round-trip', () => {
    it('stores string content and retrieves it', async () => {
      const ref = await storage.store('session-1', 'tool:echo', 'hello world');
      expect(typeof ref).toBe('string');
      expect(ref.length).toBeGreaterThan(0);

      const retrieved = await storage.retrieve('session-1', ref);
      expect(retrieved).toBe('hello world');
    });

    it('stores object content and retrieves it', async () => {
      const original = { path: '/etc/config', content: 'secret', nested: { a: 1 } };
      const ref = await storage.store('session-1', 'tool:read_file', original);
      const retrieved = await storage.retrieve('session-1', ref);
      expect(retrieved).toEqual(original);
    });

    it('stores array content and retrieves it', async () => {
      const original = [1, 2, 3, 'four'];
      const ref = await storage.store('session-1', 'tool:list', original);
      const retrieved = await storage.retrieve('session-1', ref);
      expect(retrieved).toEqual(original);
    });

    it('returns different references for different stores', async () => {
      const ref1 = await storage.store('session-1', 'tool:a', 'data-a');
      const ref2 = await storage.store('session-1', 'tool:b', 'data-b');
      expect(ref1).not.toBe(ref2);
      expect(await storage.retrieve('session-1', ref1)).toBe('data-a');
      expect(await storage.retrieve('session-1', ref2)).toBe('data-b');
    });

    it('returns undefined for non-existent reference', async () => {
      const retrieved = await storage.retrieve('session-1', 'nonexistent-ref');
      expect(retrieved).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // cross-restart persistence
  // ---------------------------------------------------------------------------
  describe('cross-restart persistence', () => {
    it('data survives re-instantiation (write file, new instance, read)', async () => {
      const original = 'persistent data';
      const ref = await storage.store('session-1', 'tool:write', original);

      // Create a new instance pointing at the same directory
      const newInstance = new FilesystemEvictionStorage(tempDir);
      const retrieved = await newInstance.retrieve('session-1', ref);
      expect(retrieved).toBe(original);
    });

    it('multiple entries survive re-instantiation', async () => {
      const refs: string[] = [];
      for (let i = 0; i < 5; i++) {
        const ref = await storage.store('session-1', `tool:${i}`, `data-${i}`);
        refs.push(ref);
      }

      const newInstance = new FilesystemEvictionStorage(tempDir);
      for (let i = 0; i < 5; i++) {
        const retrieved = await newInstance.retrieve('session-1', refs[i]!);
        expect(retrieved).toBe(`data-${i}`);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // path traversal protection
  // ---------------------------------------------------------------------------
  describe('path traversal protection', () => {
    it('rejects sessionId with ..', async () => {
      await expect(storage.store('../etc', 'key', 'data')).rejects.toThrow(/path traversal/i);
    });

    it('rejects key with ..', async () => {
      await expect(storage.store('session-1', '../../../etc/passwd', 'data')).rejects.toThrow(/path traversal/i);
    });

    it('rejects sessionId with null bytes', async () => {
      await expect(storage.store('session\0evil', 'key', 'data')).rejects.toThrow();
    });

    it('rejects key with null bytes', async () => {
      await expect(storage.store('session-1', 'key\0evil', 'data')).rejects.toThrow();
    });

    it('rejects reference with path traversal during retrieve', async () => {
      await expect(storage.retrieve('session-1', '../../etc/passwd')).rejects.toThrow(/path traversal/i);
    });

    it('allows legitimate sessionId and key values', async () => {
      const ref = await storage.store('my-session-123', 'tool:read_file', 'ok');
      const retrieved = await storage.retrieve('my-session-123', ref);
      expect(retrieved).toBe('ok');
    });
  });

  // ---------------------------------------------------------------------------
  // delete(sessionId) — clear all data for a session
  // ---------------------------------------------------------------------------
  describe('delete(sessionId)', () => {
    it('removes all entries for a given session', async () => {
      await storage.store('session-1', 'tool:a', 'data-a');
      await storage.store('session-1', 'tool:b', 'data-b');
      await storage.store('session-2', 'tool:c', 'data-c');

      await storage.delete('session-1');

      // session-1 data should be gone
      const files = readdirSync(tempDir);
      // Only session-2's file should remain
      for (const file of files) {
        expect(file).not.toContain('session-1');
      }
    });

    it('does not affect other sessions', async () => {
      const ref2 = await storage.store('session-2', 'tool:c', 'data-c');
      await storage.store('session-1', 'tool:a', 'data-a');

      await storage.delete('session-1');

      const retrieved = await storage.retrieve('session-2', ref2);
      expect(retrieved).toBe('data-c');
    });

    it('works when session has no data', async () => {
      // Should not throw
      await storage.delete('nonexistent-session');
    });

    it('handles path traversal in sessionId for delete', async () => {
      await expect(storage.delete('../etc')).rejects.toThrow(/path traversal/i);
    });
  });

  // ---------------------------------------------------------------------------
  // list() — enumerate all session IDs
  // ---------------------------------------------------------------------------
  describe('list()', () => {
    it('returns empty array when no data stored', async () => {
      const ids = await storage.list();
      expect(ids).toEqual([]);
    });

    it('returns session IDs for stored data', async () => {
      await storage.store('session-1', 'tool:a', 'data-a');
      await storage.store('session-2', 'tool:b', 'data-b');
      await storage.store('session-1', 'tool:c', 'data-c');

      const ids = await storage.list();
      expect(ids.sort()).toEqual(['session-1', 'session-2']);
    });

    it('updates list after delete', async () => {
      await storage.store('session-1', 'tool:a', 'data-a');
      await storage.store('session-2', 'tool:b', 'data-b');

      await storage.delete('session-1');

      const ids = await storage.list();
      expect(ids).toEqual(['session-2']);
    });
  });

  // ---------------------------------------------------------------------------
  // compatibility with evictionPlugin
  // ---------------------------------------------------------------------------
  describe('compatibility with evictionPlugin', () => {
    it('implements the EvictionStorage interface (store + retrieve)', async () => {
      const largeContent = 'x'.repeat(500);
      const ref = await storage.store('session-1', 'read_file', largeContent);
      const retrieved = await storage.retrieve('session-1', ref);
      expect(retrieved).toBe(largeContent);
    });

    it('handles multiple stores and retrieves correctly', async () => {
      const refs: string[] = [];
      for (let i = 0; i < 10; i++) {
        const ref = await storage.store('session-1', `tool:${i}`, `data-${i}`);
        refs.push(ref);
      }
      for (let i = 0; i < 10; i++) {
        const retrieved = await storage.retrieve('session-1', refs[i]!);
        expect(retrieved).toBe(`data-${i}`);
      }
    });
  });
});
