/**
 * AgentForge Vector Store Interface
 *
 * Abstracts vector storage and retrieval for semantic memory.
 *
 * @module
 */

// ============================================================
// Vector Document
// ============================================================

/**
 * Vector Document
 */
export interface VectorDocument {
  /** Unique ID */
  id: string;

  /** Embedding vector */
  embedding: number[];

  /** Original content */
  content: string;

  /** Metadata */
  metadata?: Record<string, unknown>;

  /** Creation timestamp (ms) */
  createdAt: number;
}

// ============================================================
// Vector Search Result
// ============================================================

/**
 * Vector Search Result
 */
export interface VectorSearchResult {
  /** Document */
  document: VectorDocument;

  /** Similarity score (0-1, higher is more similar) */
  score: number;
}

// ============================================================
// Vector Store Interface
// ============================================================

/**
 * Vector Store Interface
 */
export interface VectorStore {
  /** Store name for logging */
  readonly name: string;

  /**
   * Insert a document with embedding
   */
  insert(doc: VectorDocument): void;

  /**
   * Insert multiple documents (batch)
   */
  insertBatch(docs: VectorDocument[]): void;

  /**
   * Search similar documents by embedding
   *
   * @param embedding - Query embedding vector
   * @param limit - Max results (default: 5)
   * @param threshold - Min similarity score (default: 0.7)
   * @returns Matching documents with scores
   */
  search(embedding: number[], limit?: number, threshold?: number): VectorSearchResult[];

  /**
   * Get document by ID
   */
  get(id: string): VectorDocument | null;

  /**
   * Delete document by ID
   */
  delete(id: string): void;

  /**
   * Delete all documents
   */
  clear(): void;

  /**
   * Get document count
   */
  count(): number;

  /**
   * Close connection (cleanup)
   */
  close(): void;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
