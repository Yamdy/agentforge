// ========== Truncate Temp File Storage ==========

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

/**
 * Default directory for storing truncated output files.
 */
export const DEFAULT_TRUNCATE_DIR = join(tmpdir(), 'agentforge', 'truncated');

/**
 * Save full output content to a temp file.
 *
 * Creates the directory if it doesn't exist, then writes the content
 * to the specified file within the truncate temp directory.
 *
 * @param content - The full output content to save
 * @param dir - Directory to save into (defaults to OS temp dir + agentforge/truncated)
 * @param fileName - Name of the file to create
 * @returns Absolute path to the saved file
 */
export async function saveTruncatedOutput(
  content: string,
  dir: string = DEFAULT_TRUNCATE_DIR,
  fileName: string
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, fileName);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}
