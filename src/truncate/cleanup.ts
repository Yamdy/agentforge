// ========== Truncate Auto-Cleanup ==========

import { join } from 'node:path';
import { readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DEFAULT_TRUNCATE_DIR } from './storage.js';

/**
 * Maximum age (in days) for temp files before auto-cleanup.
 */
export const DEFAULT_MAX_AGE_DAYS = 7;

/**
 * Clean up old truncated output files.
 *
 * Scans the truncate temp directory and deletes files older than
 * `maxAgeDays`. This should be called periodically (e.g., on agent startup)
 * to prevent temp file accumulation.
 *
 * @param maxAgeDays - Maximum age in days before deletion (default: 7)
 * @param dir - Directory to scan (defaults to OS temp dir + agentforge/truncated)
 * @returns Number of files deleted
 */
export async function cleanupOldFiles(
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
  dir: string = DEFAULT_TRUNCATE_DIR
): Promise<number> {
  if (!existsSync(dir)) {
    return 0;
  }

  const files = await readdir(dir);
  const now = Date.now();
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const stats = await stat(filePath);
      // Only clean up regular files (skip directories)
      if (stats.isFile() && now - stats.mtimeMs > maxAge) {
        await rm(filePath);
        deleted++;
      }
    } catch {
      // File may have been removed between readdir and stat — ignore
    }
  }

  return deleted;
}
