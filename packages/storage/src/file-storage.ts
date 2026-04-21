import { Effect } from "effect";
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { StorageError, type FileStorageConfig, type Storage } from "./types";

/**
 * 文件系统存储实现，每个键对应一个JSON文件，按层级目录存储
 */
export class FileStorage implements Storage {
  private rootDir: string;
  private locks: Map<string, Promise<void>> = new Map(); // 简单读写锁实现
  private config: Required<FileStorageConfig>;

  constructor(config?: FileStorageConfig) {
    // 默认配置
    this.config = {
      rootDir: config?.rootDir ?? path.join(os.homedir(), ".agentforge", "storage"),
      encryptionKey: config?.encryptionKey ?? "",
      encryptFields: config?.encryptFields ?? ["content", "tool_calls", "metadata"],
      autoCleanup: config?.autoCleanup ?? {},
      cacheSize: config?.cacheSize ?? 100
    };
    this.rootDir = this.config.rootDir;
  }

  /**
   * 把键路径转换为文件路径
   */
  private keyToPath(key: string[]): string {
    return path.join(this.rootDir, ...key) + ".json";
  }

  /**
   * 简单的锁机制，保证同一时间只有一个操作修改同一个文件
   */
  private async withLock<T>(key: string[], op: (filePath: string) => Promise<T>): Promise<T> {
    const filePath = path.normalize(this.keyToPath(key));
    // 等待现有锁释放
    while (this.locks.has(filePath)) {
      await this.locks.get(filePath);
    }
    // 加锁
    let resolveLock: () => void = () => {};
    const lock = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.locks.set(filePath, lock);
    try {
      return await op(filePath);
    } finally {
      // 释放锁
      resolveLock();
      this.locks.delete(filePath);
    }
  }

  // 接口实现
  read<T>(key: string[]): Effect.Effect<T, StorageError> {
    return Effect.tryPromise(() => this.withLock(key, async (filePath) => {
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content) as T;
    })).pipe(
      Effect.mapError(err => new StorageError(`Failed to read ${key.join("/")}`, err))
    );
  }

  write<T>(key: string[], data: T): Effect.Effect<void, StorageError> {
    return Effect.tryPromise(() => this.withLock(key, async (filePath) => {
      const dirPath = path.dirname(filePath);
      await mkdir(dirPath, { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    })).pipe(
      Effect.mapError(err => new StorageError(`Failed to write ${key.join("/")}`, err))
    );
  }

  update<T>(key: string[], updater: (draft: T) => void): Effect.Effect<T, StorageError> {
    return Effect.tryPromise(() => this.withLock(key, async (filePath) => {
      let data: T;
      try {
        const content = await readFile(filePath, "utf-8");
        data = JSON.parse(content) as T;
      } catch (err) {
        // 文件不存在则返回空对象
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          data = {} as T;
        } else {
          throw err;
        }
      }
      // 修改数据
      updater(data);
      // 写回
      const dirPath = path.dirname(filePath);
      await mkdir(dirPath, { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      return data;
    })).pipe(
      Effect.mapError(err => new StorageError(`Failed to update ${key.join("/")}`, err))
    );
  }

  remove(key: string[]): Effect.Effect<void, StorageError> {
    return Effect.tryPromise(() => this.withLock(key, async (filePath) => {
      try {
        await rm(filePath, { recursive: true, force: true });
      } catch (err) {
        // 文件不存在不算错误
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
    })).pipe(
      Effect.mapError(err => new StorageError(`Failed to remove ${key.join("/")}`, err))
    );
  }

  list(prefix: string[]): Effect.Effect<string[][], StorageError> {
    return Effect.tryPromise(async () => {
      const dir = path.join(this.rootDir, ...prefix);
      const listFilesRecursive = async (currentDir: string): Promise<string[]> => {
        try {
          const entries = await readdir(currentDir, { withFileTypes: true });
          const files: string[] = [];
          for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
              const subFiles = await listFilesRecursive(fullPath);
              files.push(...subFiles);
            } else if (entry.isFile() && entry.name.endsWith(".json")) {
              // 去掉.json后缀
              files.push(fullPath.slice(0, -5));
            }
          }
          return files;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
          }
          throw err;
        }
      };

      const files = await listFilesRecursive(dir);
      // 把绝对路径转换为键路径
      const prefixPath = path.join(this.rootDir, path.sep);
      return files.map(file =>
        file.slice(prefixPath.length).split(path.sep)
      );
    }).pipe(
      Effect.mapError(err => new StorageError(`Failed to list ${prefix.join("/")}`, err))
    );
  }
}
