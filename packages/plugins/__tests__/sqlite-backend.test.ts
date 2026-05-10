import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteBackend } from '../src/memory/sqlite-backend.js';

describe('SQLiteBackend', () => {
  let basePath: string;
  let backend: SQLiteBackend;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'memory-sqlite-'));
    backend = new SQLiteBackend(join(basePath, 'memory.db'));
  });

  afterEach(async () => {
    await backend.close();
    rmSync(basePath, { recursive: true, force: true });
  });

  it('stores and retrieves entries', async () => {
    await backend.store('s1', {
      role: 'user',
      content: 'Hello from SQLite',
      timestamp: new Date().toISOString(),
    });

    const results = await backend.retrieve('s1');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Hello from SQLite');
  });

  it('persists across backend instances', async () => {
    await backend.store('s1', {
      role: 'user',
      content: 'persistent data',
      timestamp: new Date().toISOString(),
    });
    await backend.close();

    // Create new instance pointing to same DB
    const backend2 = new SQLiteBackend(join(basePath, 'memory.db'));
    const results = await backend2.retrieve('s1');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('persistent data');
    await backend2.close();
  });

  it('limits retrieved entries', async () => {
    for (let i = 0; i < 5; i++) {
      await backend.store('s1', {
        role: 'user',
        content: `msg-${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      });
    }

    const results = await backend.retrieve('s1', { limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].content).toBe('msg-3');
    expect(results[1].content).toBe('msg-4');
  });

  it('searches across sessions', async () => {
    await backend.store('s1', {
      role: 'user',
      content: 'What is the weather?',
      timestamp: new Date().toISOString(),
    });
    await backend.store('s2', {
      role: 'assistant',
      content: 'The weather is sunny.',
      timestamp: new Date().toISOString(),
    });

    const results = await backend.search('weather');
    expect(results).toHaveLength(2);
  });

  it('stores and retrieves metadata', async () => {
    await backend.store('s1', {
      role: 'user',
      content: 'with metadata',
      timestamp: new Date().toISOString(),
      metadata: { source: 'test', priority: 1 },
    });

    const results = await backend.retrieve('s1');
    expect(results[0].metadata).toEqual({ source: 'test', priority: 1 });
  });
});
