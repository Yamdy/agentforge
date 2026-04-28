// Test server from server directory
async function test() {
  // Create session
  const sessionRes = await fetch('http://127.0.0.1:3000/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentConfigId: 'default' }),
  });
  const session = await sessionRes.json();
  console.log('Session:', session.id);

  // Chat with stream
  const chatRes = await fetch(
    `http://127.0.0.1:3000/api/sessions/${session.id}/chat/stream`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello, what is your name?' }),
    }
  );

  console.log('Chat status:', chatRes.status);
  const text = await chatRes.text();
  console.log('Chat response:', text);
}

test().catch(console.error);