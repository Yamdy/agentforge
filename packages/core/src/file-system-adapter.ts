/**
 * FileSystemAdapter - abstract interface for file system operations
 *
 * Enables testing and remote file system support through dependency injection.
 */

import type { FileSystemAdapter } from '@primo-ai/sdk';
import { readFile as fsReadFile, writeFile as fsWriteFile, unlink, mkdir, stat } from 'node:fs/promises';
import { glob } from 'glob';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

/**
 * Node.js file system adapter implementation.
 */
export class NodeFsAdapter implements FileSystemAdapter {
  async readFile(path: string): Promise<string | Buffer> {
    const content = await fsReadFile(path);
    // Check if content appears to be binary (contains null bytes or
    // significant non-printable characters)
    for (let i = 0; i < content.length; i++) {
      const byte = content[i];
      // Null byte or control characters (except tab, newline, carriage return)
      if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
        return content; // Return Buffer for binary content
      }
    }
    // Return as string for text content
    return content.toString('utf-8');
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    // Ensure parent directories exist
    const parent = dirname(path);
    await mkdir(parent, { recursive: true });

    const data = typeof content === 'string' ? content : content;
    await fsWriteFile(path, data);
  }

  async deleteFile(path: string): Promise<void> {
    await unlink(path);
  }

  async listFiles(pattern: string): Promise<string[]> {
    // On Windows, convert backslashes to forward slashes for glob
    const normalizedPattern = process.platform === 'win32'
      ? pattern.replace(/\\/g, '/')
      : pattern;

    const files = await glob(normalizedPattern, {
      nodir: true,
      windowsPathsNoEscape: process.platform === 'win32'
    });
    return files;
  }

  async hashFile(path: string): Promise<string> {
    const content = await fsReadFile(path);
    return createHash('sha256').update(content).digest('hex');
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (err: unknown) {
      if (this.isENOENT(err)) return false;
      throw err;
    }
  }

  private isENOENT(err: unknown): err is { code: 'ENOENT' } {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'ENOENT';
  }
}
