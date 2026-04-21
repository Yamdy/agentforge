import { Effect } from "effect";
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { StorageError, type FileStorageConfig, type Storage } from "./types";

class LRUCache {
  private cache: Map<string, unknown>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: string): unknown | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: unknown): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  get size(): number {
    return this.cache.size;
  }
}

export class FileStorage implements Storage {
  private rootDir: string;
  private locks: Map<string, Promise<void>> = new Map();
  private config: Required<FileStorageConfig>;
  private cache: LRUCache;
  private cipher?: crypto.CipherGCM;
  private decipher?: crypto.DecipherGCM;

  constructor(config?: FileStorageConfig) {
    this.config = {
      rootDir: config?.rootDir ?? path.join(os.homedir(), ".agentforge", "storage"),
      encryptionKey: config?.encryptionKey ?? "",
      encryptFields: config?.encryptFields ?? ["content", "tool_calls", "metadata"],
      autoCleanup: config?.autoCleanup ?? {},
      cacheSize: config?.cacheSize ?? 100
    };
    this.rootDir = this.config.rootDir;
    this.cache = new LRUCache(this.config.cacheSize);

    if (this.config.encryptionKey) {
      try {
        const key = crypto.scryptSync(this.config.encryptionKey, "salt", 32);
        const iv = crypto.scryptSync(this.config.encryptionKey, "iv", 16);
        this.cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        this.decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      } catch (err) {
        console.warn("Failed to initialize encryption, proceeding without encryption", err);
      }
    }
  }

  private keyToPath(key: string[]): string {
    return path.join(this.rootDir, ...key) + ".json";
  }

  private encrypt(text: string): string {
    if (!this.cipher) return text;
    return this.cipher.update(text, "utf8", "hex") + this.cipher.final("hex");
  }

  private decrypt(encrypted: string): string {
    if (!this.decipher) return encrypted;
    return this.decipher.update(encrypted, "hex", "utf8") + this.decipher.final("utf8");
  }

  private encryptFieldsRecursive(data: any): any {
    if (!this.cipher || !this.config.encryptFields || this.config.encryptFields.length === 0) {
      return data;
    }

    if (typeof data !== "object" || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.encryptFieldsRecursive(item));
    }

    const result: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (this.config.encryptFields.includes(key)) {
        result[key] = this.encrypt(JSON.stringify(value));
      } else {
        result[key] = this.encryptFieldsRecursive(value);
      }
    }

    return result;
  }

  private decryptFieldsRecursive(data: any): any {
    if (!this.decipher || !this.config.encryptFields || this.config.encryptFields.length === 0) {
      return data;
    }

    if (typeof data !== "object" || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.decryptFieldsRecursive(item));
    }

    const result: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (this.config.encryptFields.includes(key)) {
        try {
          result[key] = JSON.parse(this.decrypt(value as string));
        } catch (err) {
          console.warn(`Failed to decrypt field ${key}:`, err);
          result[key] = value;
        }
      } else {
        result[key] = this.decryptFieldsRecursive(value);
      }
    }

    return result;
  }

  private async withLock<T>(key: string[], op: (filePath: string) => Promise<T>): Promise<T> {
    const filePath = path.normalize(this.keyToPath(key));
    while (this.locks.has(filePath)) {
      await this.locks.get(filePath);
    }
    let resolveLock: () => void = () => {};
    const lock = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.locks.set(filePath, lock);
    try {
      return await op(filePath);
    } finally {
      resolveLock();
      this.locks.delete(filePath);
    }
  }

  read<T>(key: string[]): Effect.Effect<T, StorageError> {
    return Effect.tryPromise({
      try: async () => {
        const cacheKey = key.join("/");
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
          return cached as T;
        }

        return this.withLock(key, async (filePath) => {
          const content = await readFile(filePath, "utf-8");
          const data = JSON.parse(content);
          const decryptedData = this.decryptFieldsRecursive(data);
          this.cache.set(cacheKey, decryptedData);
          return decryptedData as T;
        });
      },
      catch: (err) => new StorageError(`Failed to read ${key.join("/")}`, err)
    });
  }

  write<T>(key: string[], data: T): Effect.Effect<void, StorageError> {
    return Effect.tryPromise({
      try: async () => {
        await this.withLock(key, async (filePath) => {
          const dirPath = path.dirname(filePath);
          await mkdir(dirPath, { recursive: true });
          const encryptedData = this.encryptFieldsRecursive(data);
          await writeFile(filePath, JSON.stringify(encryptedData, null, 2), "utf-8");
          this.cache.delete(key.join("/"));
        });
      },
      catch: (err) => new StorageError(`Failed to write ${key.join("/")}`, err)
    });
  }

  update<T>(key: string[], updater: (draft: T) => void): Effect.Effect<T, StorageError> {
    return Effect.tryPromise({
      try: async () => {
        return this.withLock(key, async (filePath) => {
          let data: T;
          try {
            const content = await readFile(filePath, "utf-8");
            const parsedData = JSON.parse(content);
            data = this.decryptFieldsRecursive(parsedData);
          } catch (err: any) {
            if (err.code === "ENOENT") {
              data = {} as T;
            } else {
              throw err;
            }
          }
          updater(data);
          const encryptedDraft = this.encryptFieldsRecursive(data);
          const dirPath = path.dirname(filePath);
          await mkdir(dirPath, { recursive: true });
          await writeFile(filePath, JSON.stringify(encryptedDraft, null, 2), "utf-8");
          this.cache.delete(key.join("/"));
          return this.decryptFieldsRecursive(encryptedDraft);
        });
      },
      catch: (err) => new StorageError(`Failed to update ${key.join("/")}`, err)
    });
  }

  remove(key: string[]): Effect.Effect<void, StorageError> {
    return Effect.tryPromise({
      try: async () => {
        await this.withLock(key, async (filePath) => {
          try {
            await rm(filePath, { recursive: true, force: true });
          } catch (err: any) {
            if (err.code !== "ENOENT") {
              throw err;
            }
          }
          this.cache.delete(key.join("/"));
        });
      },
      catch: (err) => new StorageError(`Failed to remove ${key.join("/")}`, err)
    });
  }

  list(prefix: string[]): Effect.Effect<string[][], StorageError> {
    return Effect.tryPromise({
      try: async () => {
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
                files.push(fullPath.slice(0, -5));
              }
            }
            return files;
          } catch (err: any) {
            if (err.code === "ENOENT") {
              return [];
            }
            throw err;
          }
        };

        const files = await listFilesRecursive(dir);
        const prefixPath = path.join(this.rootDir, path.sep);
        return files.map(file =>
          file.slice(prefixPath.length).split(path.sep)
        );
      },
      catch: (err) => new StorageError(`Failed to list ${prefix.join("/")}`, err)
    });
  }
}
