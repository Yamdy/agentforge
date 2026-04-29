/**
 * Filesystem Tools for AgentForge
 *
 * Provides 6 sandboxed filesystem tools:
 * - read_file: Read file contents with line numbers
 * - write_file: Write content to file
 * - edit_file: Search and replace in file
 * - ls: List directory contents
 * - glob: Pattern matching for files
 * - grep: Content search in files
 *
 * Security: All tools use resolveSafePath() + isWithinRoot() to prevent path traversal.
 * Phase 1 uses path.resolve (string operations, no filesystem checks).
 */

import { z } from 'zod';
import { readFile, writeFile, mkdir, readdir, stat, unlink, rmdir } from 'fs/promises';
import { resolve, join, dirname, relative } from 'path';
import type { ToolDefinition } from '../core/interfaces.js';

// ============================================================
// Configuration
// ============================================================

/**
 * Configuration for filesystem tools.
 *
 * @param rootDir - Sandbox root directory. All file operations are restricted to this directory.
 * @param writable - Allow write operations (default: true). When false, write_file and edit_file reject.
 * @param maxFileSize - Maximum file size in bytes for read/write operations (default: 10MB).
 * @param excludePatterns - Glob patterns to exclude from search operations.
 * @param backend - Optional FilesystemBackend implementation. Defaults to LocalFilesystemBackend.
 */
export interface FilesystemToolsConfig {
  rootDir: string;
  writable?: boolean;
  maxFileSize?: number;
  excludePatterns?: string[];
  backend?: FilesystemBackend;
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ============================================================
// Filesystem Backend Interface
// ============================================================

/**
 * FilesystemBackend — abstraction for filesystem operations.
 *
 * Provides a pluggable backend for the filesystem tools, enabling
 * replacement of local filesystem with cloud storage (S3, Azure Blob, etc.).
 *
 * This is a tool-level interface, NOT a framework-level DI interface
 * (it lives in tools/filesystem.ts, not core/interfaces.ts).
 */
export interface FilesystemBackend {
  /** Read file content as UTF-8 string */
  read(path: string): Promise<string>;

  /** Write content to file, creating parent directories if needed */
  write(path: string, content: string): Promise<void>;

  /** List directory contents with type indicators */
  list(path: string): Promise<Array<{ name: string; isDirectory: boolean; size?: number }>>;

  /** Get file/directory metadata */
  stat(path: string): Promise<{ size: number; mtime: Date; isFile: boolean; isDirectory: boolean }>;

  /** Create directory (with recursive option) */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /** Delete file or directory */
  delete(path: string): Promise<void>;
}

// ============================================================
// Local Filesystem Backend
// ============================================================

/**
 * LocalFilesystemBackend — default implementation using Node.js fs/promises.
 *
 * All paths are resolved relative to rootDir for sandbox safety.
 */
export class LocalFilesystemBackend implements FilesystemBackend {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  async read(path: string): Promise<string> {
    const safePath = resolveSafePath(this.rootDir, path);
    return readFile(safePath, 'utf-8');
  }

  async write(path: string, content: string): Promise<void> {
    const safePath = resolveSafePath(this.rootDir, path);
    await mkdir(dirname(safePath), { recursive: true });
    await writeFile(safePath, content, 'utf-8');
  }

  async list(path: string): Promise<Array<{ name: string; isDirectory: boolean; size?: number }>> {
    const safePath = resolveSafePath(this.rootDir, path);
    const entries = await readdir(safePath, { withFileTypes: true });
    const result: Array<{ name: string; isDirectory: boolean; size?: number }> = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        result.push({ name: `${entry.name}/`, isDirectory: true });
      } else {
        try {
          const fullPath = join(safePath, entry.name);
          const stats = await stat(fullPath);
          result.push({ name: entry.name, isDirectory: false, size: stats.size });
        } catch {
          result.push({ name: entry.name, isDirectory: false });
        }
      }
    }
    return result;
  }

  async stat(
    path: string
  ): Promise<{ size: number; mtime: Date; isFile: boolean; isDirectory: boolean }> {
    const safePath = resolveSafePath(this.rootDir, path);
    const stats = await stat(safePath);
    return {
      size: stats.size,
      mtime: stats.mtime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const safePath = resolveSafePath(this.rootDir, path);
    await mkdir(safePath, options);
  }

  async delete(path: string): Promise<void> {
    const safePath = resolveSafePath(this.rootDir, path);
    const stats = await stat(safePath);
    if (stats.isDirectory()) {
      await rmdir(safePath, { recursive: true });
    } else {
      await unlink(safePath);
    }
  }
}

// ============================================================
// Security Helpers
// ============================================================

/**
 * Resolve a path relative to rootDir, normalizing traversal sequences.
 * If the path is relative, it's joined with rootDir.
 * If the path is absolute, it's resolved as-is (then checked by isWithinRoot).
 */
export function resolveSafePath(rootDir: string, filePath: string): string {
  if (!filePath.startsWith('/')) {
    return resolve(rootDir, filePath);
  }
  return resolve(filePath);
}

/**
 * Check that a resolved path is within the root directory.
 * Prevents path traversal attacks by ensuring the normalized path starts with rootDir.
 * Normalizes path separators for cross-platform compatibility.
 */
export function isWithinRoot(rootDir: string, filePath: string): boolean {
  const resolvedRoot = resolve(rootDir).replace(/\\/g, '/');
  const resolvedPath = resolve(filePath).replace(/\\/g, '/');
  // Ensure the path is within root (with trailing separator check for exact match)
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + '/');
}

/**
 * Validate that a path is within root and return the safe resolved path.
 * Returns an error message string if validation fails, or the safe path if it passes.
 */
function validatePath(
  rootDir: string,
  filePath: string
): { ok: true; safePath: string } | { ok: false; error: string } {
  const resolved = resolveSafePath(rootDir, filePath);
  if (!isWithinRoot(rootDir, resolved)) {
    return {
      ok: false,
      error: `Error: Access denied. Path "${filePath}" resolves outside the sandbox directory.`,
    };
  }
  return { ok: true, safePath: resolved };
}

// ============================================================
// Zod Schemas
// ============================================================

const ReadFileSchema = z.object({
  path: z.string().describe('Path to the file to read (relative to rootDir or absolute)'),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Line number to start reading from (1-based)'),
  limit: z.number().int().min(1).optional().describe('Maximum number of lines to read'),
});

const WriteFileSchema = z.object({
  path: z.string().describe('Path to the file to write (relative to rootDir or absolute)'),
  content: z.string().describe('Content to write to the file'),
});

const EditFileSchema = z.object({
  path: z.string().describe('Path to the file to edit (relative to rootDir or absolute)'),
  search: z.string().describe('Text to search for'),
  replace: z.string().describe('Text to replace with'),
  replaceAll: z
    .boolean()
    .optional()
    .default(false)
    .describe('Replace all occurrences (default: first only)'),
});

const LsSchema = z.object({
  path: z
    .string()
    .default('.')
    .describe('Path to the directory to list (relative to rootDir or absolute)'),
});

const GlobSchema = z.object({
  pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts")'),
  excludePatterns: z.array(z.string()).optional().describe('Glob patterns to exclude'),
});

const GrepSchema = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  path: z.string().default('.').describe('Path to search in (relative to rootDir or absolute)'),
  includePatterns: z
    .array(z.string())
    .optional()
    .describe('File patterns to include (e.g., ["*.ts"])'),
});

// ============================================================
// Tool Implementations
// ============================================================

/**
 * Create the read_file tool.
 * Reads file contents and returns them with line numbers.
 */
function createReadFileTool(config: FilesystemToolsConfig): ToolDefinition {
  const rootDir = resolve(config.rootDir);
  const maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  return {
    name: 'read_file',
    description:
      'Read the contents of a file. Returns the file content with line numbers. ' +
      'Supports offset and limit for reading specific line ranges. ' +
      'All paths are restricted to the sandbox root directory.',
    parameters: ReadFileSchema,
    execute: async (args: unknown): Promise<string> => {
      const parsed = ReadFileSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { path: filePath, offset, limit } = parsed.data;

      const validation = validatePath(rootDir, filePath);
      if (!validation.ok) return validation.error;
      const safePath = validation.safePath;

      try {
        // Check file size
        const stats = await stat(safePath);
        if (stats.size > maxFileSize) {
          return `Error: File size (${stats.size} bytes) exceeds maximum allowed size (${maxFileSize} bytes).`;
        }

        const content = await readFile(safePath, 'utf-8');
        const lines = content.split('\n');

        // Apply offset and limit (1-based offset)
        const startLine = offset ? offset - 1 : 0;
        const endLine = limit ? startLine + limit : lines.length;
        const selectedLines = lines.slice(startLine, endLine);

        // Format with line numbers
        const numbered = selectedLines
          .map((line, idx) => `${startLine + idx + 1}: ${line}`)
          .join('\n');

        return numbered;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: Failed to read file "${filePath}": ${message}`;
      }
    },
  };
}

/**
 * Create the write_file tool.
 * Writes content to a file, creating parent directories if needed.
 */
function createWriteFileTool(config: FilesystemToolsConfig): ToolDefinition {
  const rootDir = resolve(config.rootDir);
  const maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const writable = config.writable ?? true;

  return {
    name: 'write_file',
    description:
      'Write content to a file. Creates parent directories if they do not exist. ' +
      'Overwrites existing files. All paths are restricted to the sandbox root directory.',
    parameters: WriteFileSchema,
    execute: async (args: unknown): Promise<string> => {
      if (!writable) {
        return 'Error: Write operations are not allowed. The filesystem is in read-only mode.';
      }

      const parsed = WriteFileSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { path: filePath, content } = parsed.data;

      // Check content size
      const contentSize = Buffer.byteLength(content, 'utf-8');
      if (contentSize > maxFileSize) {
        return `Error: Content size (${contentSize} bytes) exceeds maximum allowed size (${maxFileSize} bytes).`;
      }

      const validation = validatePath(rootDir, filePath);
      if (!validation.ok) return validation.error;
      const safePath = validation.safePath;

      try {
        // Create parent directories if needed
        await mkdir(dirname(safePath), { recursive: true });
        await writeFile(safePath, content, 'utf-8');
        return `Successfully wrote ${contentSize} bytes to "${filePath}"`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: Failed to write file "${filePath}": ${message}`;
      }
    },
  };
}

/**
 * Create the edit_file tool.
 * Performs search and replace operations on a file.
 */
function createEditFileTool(config: FilesystemToolsConfig): ToolDefinition {
  const rootDir = resolve(config.rootDir);
  const writable = config.writable ?? true;

  return {
    name: 'edit_file',
    description:
      'Edit a file by searching for text and replacing it. ' +
      'Supports replacing all occurrences with replaceAll=true. ' +
      'All paths are restricted to the sandbox root directory.',
    parameters: EditFileSchema,
    execute: async (args: unknown): Promise<string> => {
      if (!writable) {
        return 'Error: Write operations are not allowed. The filesystem is in read-only mode.';
      }

      const parsed = EditFileSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { path: filePath, search, replace, replaceAll } = parsed.data;

      const validation = validatePath(rootDir, filePath);
      if (!validation.ok) return validation.error;
      const safePath = validation.safePath;

      try {
        const content = await readFile(safePath, 'utf-8');

        if (!content.includes(search)) {
          return `Error: Search text not found in "${filePath}".`;
        }

        let newContent: string;
        let count: number;

        if (replaceAll) {
          const parts = content.split(search);
          count = parts.length - 1;
          newContent = content.split(search).join(replace);
        } else {
          const idx = content.indexOf(search);
          newContent = content.slice(0, idx) + replace + content.slice(idx + search.length);
          count = 1;
        }

        await writeFile(safePath, newContent, 'utf-8');
        return `Successfully replaced ${count} occurrence(s) in "${filePath}"`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: Failed to edit file "${filePath}": ${message}`;
      }
    },
  };
}

/**
 * Create the ls tool.
 * Lists directory contents with file/directory indicators.
 */
function createLsTool(config: FilesystemToolsConfig): ToolDefinition {
  const rootDir = resolve(config.rootDir);

  return {
    name: 'ls',
    description:
      'List directory contents. Shows files and directories with type indicators. ' +
      'All paths are restricted to the sandbox root directory.',
    parameters: LsSchema,
    execute: async (args: unknown): Promise<string> => {
      const parsed = LsSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { path: dirPath } = parsed.data;

      const validation = validatePath(rootDir, dirPath);
      if (!validation.ok) return validation.error;
      const safePath = validation.safePath;

      try {
        const entries = await readdir(safePath, { withFileTypes: true });
        const lines = await Promise.all(
          entries.map(async entry => {
            if (entry.isDirectory()) {
              return `${entry.name}/`;
            }
            if (entry.isSymbolicLink()) {
              return `${entry.name}@`;
            }
            // Get file size for regular files
            try {
              const fullPath = join(safePath, entry.name);
              const stats = await stat(fullPath);
              return `${entry.name} (${stats.size} bytes)`;
            } catch {
              return entry.name;
            }
          })
        );
        return lines.join('\n');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: Failed to list directory "${dirPath}": ${message}`;
      }
    },
  };
}

/**
 * Create the glob tool.
 * Finds files matching a glob pattern within the sandbox.
 */
function createGlobTool(config: FilesystemToolsConfig): ToolDefinition {
  const rootDir = resolve(config.rootDir);
  const excludePatterns = config.excludePatterns ?? [];

  return {
    name: 'glob',
    description:
      'Find files matching a glob pattern. Returns matching file paths relative to root. ' +
      'Supports exclude patterns to filter out unwanted files. ' +
      'All paths are restricted to the sandbox root directory.',
    parameters: GlobSchema,
    execute: async (args: unknown): Promise<string> => {
      const parsed = GlobSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { pattern, excludePatterns: userExcludes } = parsed.data;

      // Check for path traversal in the pattern itself
      // Patterns containing .. segments could escape the sandbox
      if (pattern.includes('..')) {
        return `Error: Access denied. Pattern "${pattern}" contains path traversal sequences.`;
      }

      // Check if the pattern itself tries to escape (e.g., starts with /etc)
      if (pattern.startsWith('/')) {
        const patternPath = resolveSafePath(rootDir, pattern);
        if (!isWithinRoot(rootDir, patternPath)) {
          return `Error: Access denied. Pattern "${pattern}" resolves outside the sandbox directory.`;
        }
      }

      const allExcludes = [...excludePatterns, ...(userExcludes ?? [])];

      try {
        const matches = await findFiles(rootDir, rootDir, pattern, allExcludes);

        if (matches.length === 0) {
          return 'No files found matching the pattern.';
        }

        return matches.join('\n');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: Failed to glob "${pattern}": ${message}`;
      }
    },
  };
}

/**
 * Simple recursive file finder that respects glob-like patterns.
 * Only searches within rootDir, ensuring sandbox safety.
 */
async function findFiles(
  rootDir: string,
  currentDir: string,
  pattern: string,
  excludePatterns: string[]
): Promise<string[]> {
  const results: string[] = [];
  await walkDir(rootDir, currentDir, pattern, excludePatterns, results);
  return results;
}

async function walkDir(
  rootDir: string,
  currentDir: string,
  pattern: string,
  excludePatterns: string[],
  results: string[]
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    // Use forward slashes for consistent glob matching
    const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');

    // Check exclude patterns
    if (isExcluded(relPath, excludePatterns)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDir(rootDir, fullPath, pattern, excludePatterns, results);
    } else if (entry.isFile()) {
      if (matchGlob(relPath, pattern)) {
        results.push(relPath);
      }
    }
  }
}

// Glob matching: * matches non-separator chars, ** matches any chars including separators,
// ? matches single non-separator char. Double-star prefix also matches root-level files.
function matchGlob(filePath: string, pattern: string): boolean {
  // Normalize separators to forward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Convert glob pattern to regex
  // Step 1: Split on ** to handle globstar separately
  const parts = normalizedPattern.split('**');
  const regexParts = parts.map(
    part =>
      part
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
        .replace(/\*/g, '[^/]*') // * matches anything except /
        .replace(/\?/g, '[^/]') // ? matches single char except /
  );

  // Join with .* (globstar: matches anything including /)
  // But also allow zero segments: **/foo should match both foo and a/b/foo
  const regexStr = regexParts.join('.*');
  const regex = new RegExp(`^${regexStr}$`);

  if (regex.test(normalizedPath)) return true;

  // For patterns starting with **/, also try matching without the leading **/
  // e.g., **/*.txt should match hello.txt (at root) AND subdir/nested.txt
  if (normalizedPattern.startsWith('**/')) {
    const strippedPattern = normalizedPattern.slice(3); // Remove leading **/
    return matchGlob(normalizedPath, strippedPattern);
  }

  return false;
}

/**
 * Check if a path matches any exclude pattern.
 */
function isExcluded(relPath: string, excludePatterns: string[]): boolean {
  if (excludePatterns.length === 0) return false;
  const normalizedPath = relPath.replace(/\\/g, '/');
  return excludePatterns.some(pattern => matchGlob(normalizedPath, pattern));
}

/**
 * Create the grep tool.
 * Searches file contents for regex patterns.
 */
function createGrepTool(config: FilesystemToolsConfig): ToolDefinition {
  const rootDir = resolve(config.rootDir);

  return {
    name: 'grep',
    description:
      'Search file contents for a regex pattern. Returns matching lines with file paths and line numbers. ' +
      'Supports include patterns to filter which files to search. ' +
      'All paths are restricted to the sandbox root directory.',
    parameters: GrepSchema,
    execute: async (args: unknown): Promise<string> => {
      const parsed = GrepSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { pattern, path: searchPath, includePatterns } = parsed.data;

      const validation = validatePath(rootDir, searchPath);
      if (!validation.ok) return validation.error;
      const safePath = validation.safePath;

      try {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, 'i');
        } catch {
          // If regex is invalid, try as literal string
          regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        const results: string[] = [];
        await grepDir(rootDir, safePath, regex, includePatterns ?? [], results);

        if (results.length === 0) {
          return `No matches found for pattern "${pattern}".`;
        }

        return results.join('\n');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: Failed to grep "${pattern}": ${message}`;
      }
    },
  };
}

/**
 * Recursively search files in a directory for regex matches.
 */
async function grepDir(
  rootDir: string,
  currentDir: string,
  regex: RegExp,
  includePatterns: string[],
  results: string[]
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      await grepDir(rootDir, fullPath, regex, includePatterns, results);
    } else if (entry.isFile()) {
      // Apply include patterns if specified
      // Match against both the full relative path and just the filename
      const normalizedRelPath = relPath.replace(/\\/g, '/');
      const fileName = entry.name;
      if (
        includePatterns.length > 0 &&
        !includePatterns.some(p => matchGlob(normalizedRelPath, p) || matchGlob(fileName, p))
      ) {
        continue;
      }

      try {
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (regex.test(line)) {
            results.push(`${normalizedRelPath}:${i + 1}: ${line}`);
          }
          // Reset regex lastIndex for non-global regex
          regex.lastIndex = 0;
        }
      } catch {
        // Skip files that can't be read (binary, permissions, etc.)
        continue;
      }
    }
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create all 6 filesystem tools with the given configuration.
 *
 * @param config - Configuration for the filesystem tools
 * @returns Array of ToolDefinition objects for read_file, write_file, edit_file, ls, glob, grep
 */
export function createFilesystemTools(config: FilesystemToolsConfig): ToolDefinition[] {
  return [
    createReadFileTool(config),
    createWriteFileTool(config),
    createEditFileTool(config),
    createLsTool(config),
    createGlobTool(config),
    createGrepTool(config),
  ];
}
