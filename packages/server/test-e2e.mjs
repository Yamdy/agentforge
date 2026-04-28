// Test script that starts the server internally and tests endpoints
import { createAgentForgeServer } from './dist/index.js';

async function test() {
  const { server, start } = createAgentForgeServer({
    port: 3100,
    configDir: './agents',
  });

  await start();
  console.log('Server started on port 3100');

  try {
    // Create session
    const sessionRes = await fetch('http://localhost:3100/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentConfigId: 'default' }),
    });
    const session = await sessionRes.json();
    console.log('Session:', session.id);

    // Chat with stream
    const chatRes = await fetch(
      `http://localhost:3100/api/sessions/${session.id}/chat/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, what is your name?' }),
      }
    );

    console.log('Chat status:', chatRes.status);
    const text = await chatRes.text();
    console.log('Chat response:', text);
  } finally {
    server.close();
  }
}

test().catch(console.error);