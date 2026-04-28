/**
 * Simple in-memory vector store for RAG agent.
 *
 * This is a demonstration implementation using cosine similarity
 * on TF-IDF-like vectors. For production use, replace with
 * Pinecone, Weaviate, or another vector database.
 */

export interface Document {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * In-memory vector store with keyword-based search.
 * Uses a simple TF-IDF-inspired scoring for demonstration.
 */
class InMemoryVectorStore {
  private documents: Document[] = [];

  /**
   * Add a document to the store.
   */
  add(doc: Document): void {
    this.documents.push(doc);
  }

  /**
   * Add multiple documents.
   */
  addMany(docs: Document[]): void {
    this.documents.push(...docs);
  }

  /**
   * Search for documents matching the query.
   * Uses keyword overlap scoring (simplified TF-IDF).
   */
  async search(query: string, topK: number = 3): Promise<SearchResult[]> {
    const queryTerms = this.tokenize(query.toLowerCase());
    if (queryTerms.length === 0) return [];

    const scored = this.documents.map((doc) => {
      const docTerms = this.tokenize(doc.content.toLowerCase());
      const overlap = queryTerms.filter((t: string) => docTerms.includes(t)).length;
      const score = overlap / Math.sqrt(queryTerms.length * docTerms.length || 1);
      return {
        content: doc.content,
        score,
        metadata: doc.metadata,
      };
    });

    return scored
      .sort((a: SearchResult, b: SearchResult) => b.score - a.score)
      .slice(0, topK)
      .filter((r: SearchResult) => r.score > 0);
  }

  /**
   * List all documents in the store.
   */
  list(): Document[] {
    return [...this.documents];
  }

  /**
   * Simple tokenizer: split on whitespace and punctuation.
   */
  private tokenize(text: string): string[] {
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t: string) => t.length > 2);
  }
}

/**
 * Singleton vector store instance with sample documents.
 */
export const vectorStore = new InMemoryVectorStore();

// Seed with sample documents
vectorStore.addMany([
  {
    id: 'doc-1',
    content: 'AgentForge is a production-ready agent framework based on RxJS event streams and Zod type safety. It provides observable, interruptible, and resumable agent building capabilities.',
    metadata: { source: 'readme', section: 'overview' },
  },
  {
    id: 'doc-2',
    content: 'The core pattern in AgentForge is Observable<AgentEvent> stream with expand recursion. All operations are transformations on the event stream, making them naturally observable and composable.',
    metadata: { source: 'architecture', section: 'event-stream' },
  },
  {
    id: 'doc-3',
    content: 'AgentForge supports three API levels: L1 (zero-code configuration), L2 (declarative createAgent), and L3 (programmatic Observable control). L2 is recommended for most developers.',
    metadata: { source: 'guide', section: 'api-levels' },
  },
  {
    id: 'doc-4',
    content: 'The tool system uses Zod schemas to define parameters. Tools are automatically converted to function definitions that the LLM can call. Each tool has a description, parameters schema, and execute function.',
    metadata: { source: 'guide', section: 'tools' },
  },
  {
    id: 'doc-5',
    content: 'AgentForge includes 10 MPU (Minimum Production Usable) modules: SQLite storage, task planning, Docker sandbox, circuit breaker, audit logging, tool security, cost control, observability, graceful shutdown, and result validation.',
    metadata: { source: 'readme', section: 'mpu-modules' },
  },
]);