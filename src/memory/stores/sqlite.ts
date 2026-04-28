/**
 * SQLite Vector Store
 *
 * Uses SQLite for vector storage with in-memory cosine similarity calculation.
 * Lightweight, no external dependencies beyond better-sqlite3 (already in project).
 *
 * @module
 */

import Database from 'better-sqlite3';
import type { VectorStore, VectorDocument, VectorSearchResult } from '../vector-store.js';
import { cosineSimilarity } from '../vector-store.js';

// ============================================================
// Types
// ============================================================

export interface SQLiteVectorStoreOptions {
  /** Database file path (default: ':memory:') */
  dbPath?: string;

  /** Table name (default: 'vectors') */
  tableName?: string;
}

// ============================================================
// SQLite Vector Store Implementation
// ============================================================

export class SQLiteVectorStore implements VectorStore {
  readonly name = 'sqlite';

  private db: Database.Database;
  private tableName: string;

  constructor(options?: SQLiteVectorStoreOptions) {
    const dbPath = options?.dbPath ?? ':memory:';
    this.tableName = options?.tableName ?? 'vectors';
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at
      ON ${this.tableName}(created_at);
    `);
  }

  insert(doc: VectorDocument): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName} (id, embedding, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const embeddingBuffer = Buffer.from(new Float32Array(doc.embedding).buffer);
    const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null;

    stmt.run(doc.id, embeddingBuffer, doc.content, metadataJson, doc.createdAt);
  }

  insertBatch(docs: VectorDocument[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName} (id, embedding, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((documents: VectorDocument[]) => {
      for (const doc of documents) {
        const embeddingBuffer = Buffer.from(new Float32Array(doc.embedding).buffer);
        const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null;
        stmt.run(doc.id, embeddingBuffer, doc.content, metadataJson, doc.createdAt);
      }
    });

    insertMany(docs);
  }

  search(embedding: number[], limit = 5, threshold = 0.7): VectorSearchResult[] {
    // 获取所有文档（对于小规模数据集可行）
    // 生产环境应使用 HNSW 索引或专用向量数据库
    const rows = this.db.prepare(`SELECT * FROM ${this.tableName}`).all() as Array<{
      id: string;
      embedding: Buffer;
      content: string;
      metadata: string | null;
      created_at: number;
    }>;

    const results: VectorSearchResult[] = [];

    for (const row of rows) {
      const docEmbedding = Array.from(new Float32Array(row.embedding.buffer));
      const score = cosineSimilarity(embedding, docEmbedding);

      if (score >= threshold) {
        const metadataJson = row.metadata;
        const docBase = {
          id: row.id,
          embedding: docEmbedding,
          content: row.content,
          createdAt: row.created_at,
        };
        const doc: VectorDocument = metadataJson
          ? {
              ...docBase,
              metadata: JSON.parse(metadataJson) as Record<string, unknown>,
            }
          : docBase;
        results.push({
          document: doc,
          score,
        });
      }
    }

    // 按相似度降序排序，返回 top-k
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  get(id: string): VectorDocument | null {
    const row = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id) as
      | {
          id: string;
          embedding: Buffer;
          content: string;
          metadata: string | null;
          created_at: number;
        }
      | undefined;

    if (!row) return null;

    const metadataJson = row.metadata;
    const docBase = {
      id: row.id,
      embedding: Array.from(new Float32Array(row.embedding.buffer)),
      content: row.content,
      createdAt: row.created_at,
    };
    const doc: VectorDocument = metadataJson
      ? {
          ...docBase,
          metadata: JSON.parse(metadataJson) as Record<string, unknown>,
        }
      : docBase;
    return doc;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
  }

  clear(): void {
    this.db.exec(`DELETE FROM ${this.tableName}`);
  }

  count(): number {
    const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`).get() as {
      count: number;
    };
    return result.count;
  }

  close(): void {
    this.db.close();
  }
}
