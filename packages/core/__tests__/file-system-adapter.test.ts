import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeFsAdapter } from '../src/file-system-adapter.js';

describe('NodeFsAdapter', () => {
  let dir: string;
  let adapter: NodeFsAdapter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fs-adapter-test-'));
    adapter = new NodeFsAdapter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readFile', () => {
    it('reads file content as string', async () => {
      const filePath = join(dir, 'test.txt');
      await writeFile(filePath, 'hello world', 'utf-8');

      const content = await adapter.readFile(filePath);
      expect(content).toBe('hello world');
    });

    it('reads file content as Buffer', async () => {
      const filePath = join(dir, 'test.bin');
      const buffer = Buffer.from([0x01, 0x02, 0x03]);
      await writeFile(filePath, buffer);

      const content = await adapter.readFile(filePath);
      expect(Buffer.isBuffer(content)).toBe(true);
      expect(content).toEqual(buffer);
    });

    it('throws ENOENT for missing file', async () => {
      await expect(adapter.readFile(join(dir, 'missing.txt'))).rejects.toThrow();
    });
  });

  describe('writeFile', () => {
    it('writes string content to file', async () => {
      const filePath = join(dir, 'output.txt');
      await adapter.writeFile(filePath, 'test content');

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('test content');
    });

    it('writes Buffer content to file', async () => {
      const filePath = join(dir, 'output.bin');
      const buffer = Buffer.from([0x04, 0x05, 0x06]);
      await adapter.writeFile(filePath, buffer);

      const content = await readFile(filePath);
      expect(Buffer.from(content)).toEqual(buffer);
    });

    it('creates parent directories if needed', async () => {
      const filePath = join(dir, 'subdir', 'nested', 'file.txt');
      await adapter.writeFile(filePath, 'nested content');

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('nested content');
    });
  });

  describe('deleteFile', () => {
    it('deletes existing file', async () => {
      const filePath = join(dir, 'to-delete.txt');
      await writeFile(filePath, 'delete me', 'utf-8');

      await adapter.deleteFile(filePath);

      await expect(readFile(filePath)).rejects.toThrow();
    });

    it('throws ENOENT for missing file', async () => {
      await expect(adapter.deleteFile(join(dir, 'missing.txt'))).rejects.toThrow();
    });
  });

  describe('listFiles', () => {
    it('lists files matching glob pattern', async () => {
      await writeFile(join(dir, 'a.txt'), 'a');
      await writeFile(join(dir, 'b.txt'), 'b');
      await writeFile(join(dir, 'c.md'), 'c');

      const files = await adapter.listFiles(join(dir, '*.txt'));

      expect(files.sort()).toEqual([
        join(dir, 'a.txt'),
        join(dir, 'b.txt')
      ]);
    });

    it('lists files in subdirectories', async () => {
      await mkdir(join(dir, 'sub'));
      await writeFile(join(dir, 'sub', 'nested.txt'), 'nested');

      const files = await adapter.listFiles(join(dir, '**/*.txt'));

      expect(files).toContain(join(dir, 'sub', 'nested.txt'));
    });

    it('returns empty array for no matches', async () => {
      const files = await adapter.listFiles(join(dir, '*.nonexistent'));
      expect(files).toEqual([]);
    });
  });

  describe('hashFile', () => {
    it('returns SHA-256 hash of file content', async () => {
      const filePath = join(dir, 'hash-test.txt');
      await writeFile(filePath, 'hello', 'utf-8');

      // SHA-256 of "hello" is 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
      const hash = await adapter.hashFile(filePath);

      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('returns consistent hash for same content', async () => {
      const filePath = join(dir, 'consistent.txt');
      await writeFile(filePath, 'same content', 'utf-8');

      const hash1 = await adapter.hashFile(filePath);
      const hash2 = await adapter.hashFile(filePath);

      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different content', async () => {
      const file1 = join(dir, 'file1.txt');
      const file2 = join(dir, 'file2.txt');
      await writeFile(file1, 'content A', 'utf-8');
      await writeFile(file2, 'content B', 'utf-8');

      const hash1 = await adapter.hashFile(file1);
      const hash2 = await adapter.hashFile(file2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('exists', () => {
    it('returns true for existing file', async () => {
      const filePath = join(dir, 'exists.txt');
      await writeFile(filePath, 'content', 'utf-8');

      expect(await adapter.exists(filePath)).toBe(true);
    });

    it('returns false for missing file', async () => {
      expect(await adapter.exists(join(dir, 'missing.txt'))).toBe(false);
    });

    it('returns true for existing directory', async () => {
      await mkdir(join(dir, 'subdir'));
      expect(await adapter.exists(join(dir, 'subdir'))).toBe(true);
    });
  });
});
