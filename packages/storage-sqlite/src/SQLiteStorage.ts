import { Effect } from "effect";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import { StorageError, type Storage, type FileStorageConfig } from "@agentforge/storage";
import { CREATE_TABLES_SQL, TABLES } from "./schema";

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

export class SQLiteStorage implements Storage {
  private db: Database.Database;
  private config: Required<FileStorageConfig>;
  private cache: LRUCache;
  private cipher?: crypto.CipherGCM;
  private decipher?: crypto.DecipherGCM;

  constructor(config?: FileStorageConfig) {
    this.config = {
      rootDir: config?.rootDir ?? ":memory:",
      encryptionKey: config?.encryptionKey ?? "",
      encryptFields: config?.encryptFields ?? ["content", "tool_calls", "metadata"],
      autoCleanup: config?.autoCleanup ?? {},
      cacheSize: config?.cacheSize ?? 100
    };
    
    const filePath = this.config.rootDir === ":memory:" ? ":memory:" : this.config.rootDir;
    this.db = new Database(filePath);
    this.cache = new LRUCache(this.config.cacheSize);
    
    this.initializeTables();

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

  private initializeTables(): void {
    this.db.exec(CREATE_TABLES_SQL);
  }

  private keyToString(key: string[]): string {
    return key.join("/");
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

  read<T>(key: string[]): Effect.Effect<T, StorageError> {
    return Effect.try({
      try: () => {
        const keyStr = this.keyToString(key);
        const cached = this.cache.get(keyStr);
        if (cached !== undefined) {
          return cached as T;
        }

        const stmt = this.db.prepare(`SELECT value FROM ${TABLES.KEY_VALUE} WHERE key = ?`);
        const row = stmt.get(keyStr) as { value: string } | undefined;

        if (!row) {
          throw new Error(`Record not found: ${keyStr}`);
        }

        const data = JSON.parse(row.value);
        const decryptedData = this.decryptFieldsRecursive(data);
        this.cache.set(keyStr, decryptedData);
        return decryptedData as T;
      },
      catch: (e) => new StorageError(`Failed to read ${key.join("/")}`, e)
    });
  }

  write<T>(key: string[], data: T): Effect.Effect<void, StorageError> {
    return Effect.try({
      try: () => {
        const keyStr = this.keyToString(key);
        const encryptedData = this.encryptFieldsRecursive(data);
        const dataJson = JSON.stringify(encryptedData);
        const now = Date.now();

        const stmt = this.db.prepare(
          `INSERT OR REPLACE INTO ${TABLES.KEY_VALUE} (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`
        );
        stmt.run(keyStr, dataJson, now, now);
        this.cache.delete(keyStr);
      },
      catch: (e) => new StorageError(`Failed to write ${key.join("/")}`, e)
    });
  }

  update<T>(key: string[], updater: (draft: T) => void): Effect.Effect<T, StorageError> {
    return Effect.try({
      try: () => {
        const keyStr = this.keyToString(key);
        
        let data: T;
        try {
          const stmt = this.db.prepare(`SELECT value FROM ${TABLES.KEY_VALUE} WHERE key = ?`);
          const row = stmt.get(keyStr) as { value: string } | undefined;
          if (row) {
            const parsedData = JSON.parse(row.value);
            data = this.decryptFieldsRecursive(parsedData);
          } else {
            data = {} as T;
          }
        } catch {
          data = {} as T;
        }
        
        updater(data);
        const encryptedDraft = this.encryptFieldsRecursive(data);
        const dataJson = JSON.stringify(encryptedDraft);
        const now = Date.now();
        
        const stmt = this.db.prepare(
          `INSERT OR REPLACE INTO ${TABLES.KEY_VALUE} (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`
        );
        stmt.run(keyStr, dataJson, now, now);
        this.cache.delete(keyStr);
        
        return this.decryptFieldsRecursive(encryptedDraft);
      },
      catch: (e) => new StorageError(`Failed to update ${key.join("/")}`, e)
    });
  }

  remove(key: string[]): Effect.Effect<void, StorageError> {
    return Effect.try({
      try: () => {
        const keyStr = this.keyToString(key);
        const stmt = this.db.prepare(`DELETE FROM ${TABLES.KEY_VALUE} WHERE key = ?`);
        stmt.run(keyStr);
        this.cache.delete(keyStr);
      },
      catch: (e) => new StorageError(`Failed to remove ${key.join("/")}`, e)
    });
  }

  list(prefix: string[]): Effect.Effect<string[][], StorageError> {
    return Effect.try({
      try: () => {
        const prefixStr = this.keyToString(prefix);
        const stmt = this.db.prepare(`SELECT key FROM ${TABLES.KEY_VALUE} WHERE key LIKE ?`);
        const rows = stmt.all(`${prefixStr}%`) as Array<{ key: string }>;

        return rows.map((row) => row.key.split("/"));
      },
      catch: (e) => new StorageError(`Failed to list ${prefix.join("/")}`, e)
    });
  }

  close(): void {
    this.db.close();
  }
}
