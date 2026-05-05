/**
 * File Snapshot Tracker — P2-15
 *
 * Tracks file system changes made by agent tool executions.
 * Inspired by OpenCode's snapshot.track() → snapshot.patch() pattern.
 *
 * Usage in agent loop:
 *   1. const paths = extractFilePathsFromToolCalls(toolCalls);
 *   2. const before = await tracker.takeSnapshotOf(paths);
 *   3. // ... execute tool batch ...
 *   4. const after = await tracker.takeSnapshotOf(paths);
 *   5. const changes = tracker.diff(before, after);
 *   6. if (changes.length > 0) emitter.emit({ type: 'file.change', ... });
 */

import { stat } from 'node:fs/promises';

// ============================================================
// Types
// ============================================================

export interface FileState {
  exists: boolean;
  size: number;
  mtimeMs: number;
}

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  before: FileState | null;
  after: FileState | null;
}

export interface FileSnapshot {
  files: Map<string, FileState>;
  timestamp: number;
}

export type FileChangeHandler = (changes: FileChange[], sessionId: string) => void;

// ============================================================
// Path extraction heuristics for common tool patterns
// ============================================================

const PATH_ARG_KEYS = new Set([
  'path',
  'filePath',
  'file',
  'target',
  'dest',
  'destination',
  'source',
  'src',
  'output',
  'input',
  'from',
  'to',
  'dir',
  'directory',
  'folder',
  'cwd',
]);

const UNIX_PATH_PATTERN = /(?:\/[\w.-]+)+\/?[\w.-]*\.[\w]+|^(?:\/[\w.-]+)+$/;
const WIN_PATH_PATTERN =
  /(?:[A-Za-z]:\\(?:[\w.-]+\\)*[\w.-]*\.[\w]+)|(?:[A-Za-z]:\\(?:[\w.-]+\\)*[\w.-]+)/;
const RELATIVE_PATH_PATTERN =
  /(?:\.{1,2}[\\/](?:[\w.-]+[\\/])*[\w.-]+\.[\w]+)|(?:\.{1,2}[\\/](?:[\w.-]+[\\/])*[\w.-]+)/;

function looksLikePath(value: string): boolean {
  return (
    UNIX_PATH_PATTERN.test(value) ||
    WIN_PATH_PATTERN.test(value) ||
    RELATIVE_PATH_PATTERN.test(value)
  );
}

/**
 * Extract file system paths from tool call args using heuristics.
 * Matches Unix absolute paths, Windows absolute paths, and relative paths.
 * Also traverses array values (common in batch file operations).
 */
export function extractPathsFromArgs(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      if (PATH_ARG_KEYS.has(key) || looksLikePath(value)) {
        paths.push(value);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          paths.push(item);
        }
      }
    }
  }
  return paths;
}

// ============================================================
// FileTracker
// ============================================================

export class FileTracker {
  private handlers: FileChangeHandler[] = [];

  /**
   * Subscribe to file change events. Returns unsubscribe function.
   */
  onFileChange(handler: FileChangeHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  /**
   * Notify all registered handlers of detected changes.
   */
  notify(changes: FileChange[], sessionId: string): void {
    if (changes.length === 0) return;
    for (const handler of this.handlers) {
      try {
        handler(changes, sessionId);
      } catch (err) {
        console.warn('[FileTracker] File change handler error:', err);
      }
    }
  }

  /**
   * Take a snapshot of specific file paths.
   * Returns FileState for each path that exists; paths that don't exist
   * are recorded with `exists: false`.
   */
  async takeSnapshotOf(paths: string[]): Promise<FileSnapshot> {
    const snapshot: FileSnapshot = {
      files: new Map(),
      timestamp: Date.now(),
    };

    const results = await Promise.allSettled(
      paths.map(async (p): Promise<[string, FileState]> => {
        try {
          const s = await stat(p);
          return [p, { exists: true, size: s.size, mtimeMs: s.mtimeMs }];
        } catch {
          return [p, { exists: false, size: 0, mtimeMs: 0 }];
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const [path, state] = result.value;
        snapshot.files.set(path, state);
      }
      // Rejected promises only happen on unexpected errors (stat errors
      // are caught inside the callback). Record as non-existent.
    }

    return snapshot;
  }

  /**
   * Diff two snapshots and return the list of file changes.
   */
  diff(before: FileSnapshot, after: FileSnapshot): FileChange[] {
    const changes: FileChange[] = [];
    const allPaths = new Set([...before.files.keys(), ...after.files.keys()]);

    for (const path of allPaths) {
      const b = before.files.get(path) ?? null;
      const a = after.files.get(path) ?? null;

      if (b && a) {
        if (b.size !== a.size || b.mtimeMs !== a.mtimeMs) {
          changes.push({ path, type: 'modified', before: b, after: a });
        }
      } else if (!b && a && a.exists) {
        changes.push({ path, type: 'created', before: null, after: a });
      } else if (b && (!a || !a.exists)) {
        changes.push({ path, type: 'deleted', before: b, after: null });
      }
    }

    return changes;
  }
}

/**
 * Create a new FileTracker.
 */
export function createFileTracker(): FileTracker {
  return new FileTracker();
}
