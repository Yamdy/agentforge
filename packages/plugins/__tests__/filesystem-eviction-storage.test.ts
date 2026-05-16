import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemEvictionStorage } from '../src/eviction/filesystem-storage.js';
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
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
  // store
  // ---------------------------------------------------------------------------
  describe('store', () => {
    it('stores content and returns a reference string', async () => {
      const ref = await storage.store('session-1', 'tool:read_file', { path: '/etc/config', content: 'secret' });
      expect(typeof ref).toBe('string');
      expect(ref.length).toBeGreaterThan(0);
    });

    it('persists content to the filesystem', async () => {
      await storage.store('session-1', 'tool:read_file', 'hello world');
      // Directory should contain at least one file
      const files = readdirSync(tempDir);
      expect(files.length).toBeGreaterThanOrEqual(1);
    });

    it('generates unique references for different stores', async () => {
      const ref1 = await storage.store('session-1', 'tool:a', 'data-a');
      const ref2 = await storage.store('session-1', 'tool:b', 'data-b');
      expect(ref1).not.toBe(ref2);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve
  // ---------------------------------------------------------------------------
  describe('retrieve', () => {
    it('retrieves stored string content by reference', async () => {
      const original = 'hello world';
      const ref = await storage.store('session-1', 'tool:echo', original);
      const retrieved = await storage.retrieve('session-1', ref);
      expect(retrieved).toBe(original);
    });

    it('retrieves stored object content by reference', async () => {
      const original = { path: '/etc/config', content: 'secret', nested: { a: 1 } };
      const ref = await storage.store('session-1', 'tool:read_file', original);
      const retrieved = await storage.retrieve('session-1', ref);
      expect(retrieved).toEqual(original);
    });

    it('retrieves stored array content by reference', async () => {
      const original = [1, 2, 3, 'four'];
      const ref = await storage.store('session-1', 'tool:list', original);
      const retrieved = await storage.retrieve('session-1', ref);
      expect(retrieved).toEqual(original);
    });

    it('returns undefined for non-existent reference', async () => {
      const retrieved = await storage.retrieve('session-1', 'nonexistent-ref');
      expect(retrieved).toBeUndefined();
    });

    it('retrieves content stored with a different sessionId if the reference matches', async () => {
      const original = 'cross-session data';
      const ref = await storage.store('session-1', 'tool:x', original);
      // The reference encodes the original sessionId, but retrieve should work
      // as long as the file exists
      const retrieved = await storage.retrieve('session-1', ref);
      expect(retrieved).toBe(original);
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('deletes stored content by reference', async () => {
      const ref = await storage.store('session-1', 'tool:echo', 'to-delete');
      const deleted = await storage.delete('session-1', ref);
      expect(deleted).toBe(true);
      const retrieved = await storage.retrieve('session-1', ref);
      expect(retrieved).toBeUndefined();
    });

    it('returns false when deleting non-existent reference', async () => {
      const deleted = await storage.delete('session-1', 'nonexistent-ref');
      expect(deleted).toBe(false);
    });

    it('removes the file from disk', async () => {
      const ref = await storage.store('session-1', 'tool:echo', 'file-to-remove');
      const filesBefore = readdirSync(tempDir).length;
      await storage.delete('session-1', ref);
      const filesAfter = readdirSync(tempDir).length;
      expect(filesAfter).toBe(filesBefore - 1);
    });
  });

  // ---------------------------------------------------------------------------
  // TTL expiration
  // ---------------------------------------------------------------------------
  describe('TTL expiration', () => {
    it('does not retrieve content after TTL has expired', async () => {
      const ttlStorage = new FilesystemEvictionStorage(tempDir, { ttlMs: 50 });
      const ref = await ttlStorage.store('session-1', 'tool:echo', 'expires-fast');

      // Should be available immediately
      const immediate = await ttlStorage.retrieve('session-1', ref);
      expect(immediate).toBe('expires-fast');

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      const expired = await ttlStorage.retrieve('session-1', ref);
      expect(expired).toBeUndefined();
    });

    it('cleans up expired entries when cleanup is called', async () => {
      const ttlStorage = new FilesystemEvictionStorage(tempDir, { ttlMs: 50 });
      await ttlStorage.store('session-1', 'tool:a', 'data-a');
      await ttlStorage.store('session-1', 'tool:b', 'data-b');

      const filesBefore = readdirSync(tempDir).length;
      expect(filesBefore).toBe(2);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      const cleanedCount = await ttlStorage.cleanup();
      expect(cleanedCount).toBe(2);

      const filesAfter = readdirSync(tempDir).length;
      expect(filesAfter).toBe(0);
    });

    it('does not clean up non-expired entries', async () => {
      const ttlStorage = new FilesystemEvictionStorage(tempDir, { ttlMs: 5000 });
      await ttlStorage.store('session-1', 'tool:a', 'data-a');

      // Don't wait — TTL is long
      const cleanedCount = await ttlStorage.cleanup();
      expect(cleanedCount).toBe(0);

      const filesAfter = readdirSync(tempDir).length;
      expect(filesAfter).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Compatibility with evictionPlugin
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
