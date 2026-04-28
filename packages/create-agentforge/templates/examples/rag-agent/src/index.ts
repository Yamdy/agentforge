/**
 * RAG Agent - Entry Point
 *
 * Demonstrates retrieval-augmented generation with a vector store.
 * The agent searches documents before answering questions.
 */

import 'dotenv/config';
import { createAgent } from 'agentforge';
import config from '../agentforge.config.js';

const agent = createAgent(config);

async function main(): Promise<void> {
  console.log('📚 RAG Agent started. Ask questions about the indexed documents.\n');

  // Example: Ask a question that requires document retrieval
  const result = await agent.run(
    'What are the key features of the system? Search the knowledge base for relevant information.'
  );

  console.log('\n📖 Agent output:', result);
}

main().catch(console.error);