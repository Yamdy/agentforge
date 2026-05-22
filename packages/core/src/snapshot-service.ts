/**
 * SnapshotService - track, diff, and revert file system changes
 *
 * Provides audit trail and rollback capability for agent file operations.
 */

import type { SnapshotService, FileSystemAdapter, SnapshotStore, Snapshot, FileSnapshot, FilePatch } from '@primo-ai/sdk';
import { readFile } from 'node:fs/promises';

export interface SnapshotServiceOptions {
  adapter: FileSystemAdapter;
  store: SnapshotStore;
  patterns: string[];
}

/**
 * Implementation of SnapshotService for tracking file system changes.
 */
export class SnapshotServiceImpl implements SnapshotService {
  private adapter: FileSystemAdapter;
  private store: SnapshotStore;
  private patterns: string[];
  private snapshotCounter = 0;

  constructor(options: SnapshotServiceOptions) {
    this.adapter = options.adapter;
    this.store = options.store;
    this.patterns = options.patterns;
  }

  /**
   * Create a snapshot of all files matching the configured patterns.
   * Returns the snapshot ID for later reference.
   * When storeContent is true, file contents are stored for revert.
   */
  async track(storeContent?: boolean): Promise<string> {
    const files: FileSnapshot[] = [];

    // Scan all patterns and collect files
    for (const pattern of this.patterns) {
      const filePaths = await this.adapter.listFiles(pattern);

      for (const filePath of filePaths) {
        const hash = await this.adapter.hashFile(filePath);
        const entry: FileSnapshot = { path: filePath, hash };
        if (storeContent) {
          const raw = await this.adapter.readFile(filePath);
          entry.content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        }
        files.push(entry);
      }
    }

    // Sort files by path for consistent ordering
    files.sort((a, b) => a.path.localeCompare(b.path));

    const snapshotId = `snap-${Date.now()}-${++this.snapshotCounter}`;
    const snapshot: Snapshot = {
      id: snapshotId,
      createdAt: new Date().toISOString(),
      files,
      hasContent: storeContent === true,
    };

    await this.store.save(snapshot);
    return snapshotId;
  }

  /**
   * Get the differences between the current file system state and a snapshot.
   */
  async patch(snapshotId: string): Promise<FilePatch[]> {
    const snapshot = await this.store.load(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const patches: FilePatch[] = [];
    const currentFiles = new Map<string, string>();

    // Get current state of all tracked files
    for (const pattern of this.patterns) {
      const filePaths = await this.adapter.listFiles(pattern);
      for (const filePath of filePaths) {
        const hash = await this.adapter.hashFile(filePath);
        currentFiles.set(filePath, hash);
      }
    }

    // Build a map of original files
    const originalFiles = new Map<string, FileSnapshot>();
    for (const file of snapshot.files) {
      originalFiles.set(file.path, file);
    }

    // Find modified and deleted files
    for (const originalFile of snapshot.files) {
      const currentHash = currentFiles.get(originalFile.path);

      if (currentHash === undefined) {
        // File was deleted
        patches.push({
          path: originalFile.path,
          oldHash: originalFile.hash,
          type: 'deleted',
        });
      } else if (currentHash !== originalFile.hash) {
        // File was modified
        patches.push({
          path: originalFile.path,
          oldHash: originalFile.hash,
          newHash: currentHash,
          type: 'modified',
        });
      }

      // Remove from currentFiles to track what's left (new files)
      currentFiles.delete(originalFile.path);
    }

    // Remaining files in currentFiles are new
    for (const [path, hash] of currentFiles) {
      patches.push({
        path,
        newHash: hash,
        type: 'created',
      });
    }

    // Sort patches by path for consistent ordering
    patches.sort((a, b) => a.path.localeCompare(b.path));

    return patches;
  }

  /**
   * Revert all changes since the given snapshot.
   */
  async revert(snapshotId: string): Promise<void> {
    const snapshot = await this.store.load(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const patches = await this.patch(snapshotId);

    // Build a map of original file snapshots
    const originalFiles = new Map<string, FileSnapshot>();
    for (const file of snapshot.files) {
      originalFiles.set(file.path, file);
    }

    for (const patch of patches) {
      switch (patch.type) {
        case 'created': {
          // Delete the new file
          if (await this.adapter.exists(patch.path)) {
            await this.adapter.deleteFile(patch.path);
          }
          break;
        }
        case 'modified': {
          // Restore file content from the snapshot
          const original = originalFiles.get(patch.path);
          if (original?.content !== undefined) {
            await this.adapter.writeFile(patch.path, original.content);
          }
          break;
        }
        case 'deleted': {
          // Recreate the file from snapshot content
          const original = originalFiles.get(patch.path);
          if (original?.content !== undefined) {
            await this.adapter.writeFile(patch.path, original.content);
          }
          break;
        }
      }
    }
  }

  /**
   * Get a snapshot by ID (helper for testing).
   */
  async getSnapshot(snapshotId: string): Promise<Snapshot | undefined> {
    return this.store.load(snapshotId);
  }
}
