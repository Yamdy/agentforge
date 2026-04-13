import path from 'path';
import { fileURLToPath } from 'url';
import { readJson, writeJson, remove as fsRemove, scan, ensureDir } from './filesystem.js';
import { Lock } from './lock.js';
import { NotFoundError } from './filesystem.js';
export { SQLiteMemoryStorage } from './sqlite-memory.js';

export { NotFoundError };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data/storage');
ensureDir(DATA_DIR);

function resolve(key: string[]): string {
  return path.join(DATA_DIR, ...key) + '.json';
}

async function withErrorHandling<T>(body: () => Promise<T>): Promise<T> {
  return body().catch((e) => {
    if (!(e instanceof Error)) throw e;
    const errnoException = e as NodeJS.ErrnoException;
    if (errnoException.code === 'ENOENT') {
      throw new NotFoundError(`Resource not found: ${errnoException.path}`);
    }
    throw e;
  });
}

export const Storage = {
  async read<T>(key: string[]): Promise<T> {
    const target = resolve(key);
    return withErrorHandling(async () => {
      const lock = await Lock.read(target);
      try {
        return await readJson<T>(target);
      } finally {
        lock[Symbol.dispose]();
      }
    });
  },

  async write<T>(key: string[], content: T): Promise<void> {
    const target = resolve(key);
    return withErrorHandling(async () => {
      const lock = await Lock.write(target);
      try {
        await writeJson(target, content);
      } finally {
        lock[Symbol.dispose]();
      }
    });
  },

  async update<T>(key: string[], fn: (draft: T) => void): Promise<T> {
    const target = resolve(key);
    return withErrorHandling(async () => {
      const lock = await Lock.write(target);
      try {
        const content = await readJson<T>(target);
        fn(content);
        await writeJson(target, content);
        return content;
      } finally {
        lock[Symbol.dispose]();
      }
    });
  },

  async remove(key: string[]): Promise<void> {
    const target = resolve(key);
    return withErrorHandling(async () => {
      await fsRemove(target);
    });
  },

  async list(prefix: string[]): Promise<string[][]> {
    const dir = path.join(DATA_DIR, ...prefix);
    try {
      const results = await scan('*', { cwd: dir, include: 'file' });
      return results.map((x) => [...prefix, x.slice(0, -5)]);
    } catch {
      return [];
    }
  },
};
