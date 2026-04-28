// E2E test with verbose logging
import { createAgentForgeServer } from './dist/index.js';

async function test() {
  const { server, start } = createAgentForgeServer({
    port: 3100,
    configDir: './agents',
  });

  await start();
  console.log('Server started');

  try {
    // Create session
    const sessionRes = await fetch('http://localhost:3100/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentConfigId: 'default' }),
    });
    const session = await sessionRes.json();
    console.log('Session:', session.id);

    // Chat
    const chatRes = await fetch(
      `http://localhost:3100/api/sessions/${session.id}/chat/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      }
    );

    if (chatRes.body === null) {
      console.log('No response body');
      return;
    }

    const reader = chatRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      
      // Process SSE chunks
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            console.log('DONE');
            continue;
          }
          try {
            const event = JSON.parse(data);
            if (event.type === 'llm.request') {
              console.log('LLM Request messages:', JSON.stringify(event.messages, null, 2));
            }
            if (event.type === 'llm.response') {
              console.log('LLM Response:', event.content);
            }
          } catch {}
        }
      }
    }
  } finally {
    server.close();
  }
}

test().catch(console.error);