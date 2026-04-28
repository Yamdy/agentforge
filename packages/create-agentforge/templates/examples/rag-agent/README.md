# RAG Agent

A retrieval-augmented generation (RAG) agent with vector store using AgentForge.

## Features

- In-memory vector store for document embeddings
- Semantic search over indexed documents
- RAG pipeline: retrieve → augment → generate
- Zod-validated search tools

## Setup

1. Copy `.env.example` to `.env` and add your API key:

```bash
cp .env.example .env
# Edit .env with your OPENAI_API_KEY
```

2. Install dependencies:

```bash
npm install
```

3. Index documents (optional — the store starts with sample data):

```bash
npm run index
```

4. Run the agent:

```bash
npm run dev
```

## How It Works

1. **Indexing**: Documents are split into chunks and embedded into vectors
2. **Retrieval**: When the user asks a question, the agent searches for relevant chunks
3. **Augmentation**: Retrieved context is injected into the LLM prompt
4. **Generation**: The LLM generates an answer grounded in the retrieved documents

## Customization

- Replace the in-memory vector store with a real one (Pinecone, Weaviate, etc.)
- Add your own documents in `src/rag/index-documents.ts`
- Adjust the `topK` parameter for more/fewer results
- Modify the system prompt to change retrieval behavior