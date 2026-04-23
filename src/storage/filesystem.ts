import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

// Note: NotFoundError is now imported from '../errors/index.js' in storage/index.ts
// This file no longer defines its own NotFoundError to avoid duplication

export async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function write(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function read(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

export async function remove(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw e;
    }
  }
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function scan(
  pattern: string,
  options?: {
    cwd?: string;
    include?: 'file' | 'dir' | 'all';
  }
): Promise<string[]> {
  const cwd = options?.cwd ?? process.cwd();
  const include = options?.include ?? 'file';

  const entries = await fs.readdir(cwd, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(cwd, entry.name);

    if (entry.isDirectory()) {
      if (include === 'all' || include === 'dir') {
        // Check if directory matches pattern
        if (globMatch(pattern, entry.name + '/')) {
          results.push(entry.name + '/');
        }
      }
      const subResults = await scan(pattern, { cwd: fullPath, include });
      for (const sub of subResults) {
        results.push(path.join(entry.name, sub));
      }
    } else if (entry.isFile()) {
      if (include === 'all' || include === 'file') {
        if (globMatch(pattern, entry.name)) {
          results.push(entry.name);
        }
      }
    }
  }

  return results;
}

/** Simple glob matching for * pattern only */
function globMatch(pattern: string, filename: string): boolean {
  if (pattern === '*') {
    return true;
  }
  // Convert simple glob to regex
  const regexPattern =
    '^' + pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*') + '$';
  const regex = new RegExp(regexPattern);
  return regex.test(filename);
}

export function ensureDir(dirPath: string): void {
  if (!fsSync.existsSync(dirPath)) {
    fsSync.mkdirSync(dirPath, { recursive: true });
  }
}
