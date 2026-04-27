import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FileConfigStore } from '../src/config-store.js';

describe('FileConfigStore', () => {
  let store: FileConfigStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(process.cwd(), 'tmp-test-config-' + Date.now());
    await mkdir(tmpDir, { recursive: true });
    store = new FileConfigStore(tmpDir);
    // Wait for init
    await (store as unknown as { ensureInit(): Promise<void> }).ensureInit?.() ??
      new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create config directory if it does not exist', async () => {
    const newDir = join(tmpDir, 'subdir', 'deep');
    const newStore = new FileConfigStore(newDir);
    // Trigger init
    await newStore.listAgentConfigs();
    // Directory should exist now
    const { stat } = await import('node:fs/promises');
    const s = await stat(newDir);
    expect(s.isDirectory()).toBe(true);
  });

  it('should return empty list when no configs exist', async () => {
    const configs = await store.listAgentConfigs();
    expect(configs).toEqual([]);
  });

  it('should save and retrieve a config', async () => {
    const config = {
      name: 'test-agent',
      model: { provider: 'openai' as const, model: 'gpt-4o' },
      maxSteps: 10,
      streaming: false,
      parallelToolCalls: true,
      tools: [] as string[],
    };

    await store.saveAgentConfig('test-agent', config);
    const retrieved = await store.getAgentConfig('test-agent');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('test-agent');
    expect(retrieved!.model.model).toBe('gpt-4o');
  });

  it('should return null for unknown config id', async () => {
    const result = await store.getAgentConfig('nonexistent');
    expect(result).toBeNull();
  });

  it('should reject invalid config with error message', async () => {
    await expect(
      store.saveAgentConfig('bad-agent', { invalid: true }),
    ).rejects.toThrow('Invalid agent config');
  });

  it('should delete a config', async () => {
    const config = {
      name: 'delete-me',
      model: { provider: 'openai' as const, model: 'gpt-4o' },
      maxSteps: 5,
      streaming: false,
      parallelToolCalls: true,
      tools: [] as string[],
    };

    await store.saveAgentConfig('delete-me', config);
    const deleted = await store.deleteAgentConfig('delete-me');
    expect(deleted).toBe(true);

    const result = await store.getAgentConfig('delete-me');
    expect(result).toBeNull();
  });

  it('should return false when deleting nonexistent config', async () => {
    const deleted = await store.deleteAgentConfig('nonexistent');
    expect(deleted).toBe(false);
  });

  it('should list all configs', async () => {
    const config1 = {
      name: 'agent-1',
      model: { provider: 'openai' as const, model: 'gpt-4o' },
      maxSteps: 10,
      streaming: false,
      parallelToolCalls: true,
      tools: [] as string[],
    };
    const config2 = {
      name: 'agent-2',
      model: { provider: 'anthropic' as const, model: 'claude-3-5-sonnet-20241022' },
      maxSteps: 5,
      streaming: true,
      parallelToolCalls: false,
      tools: ['bash'] as string[],
    };

    await store.saveAgentConfig('agent-1', config1);
    await store.saveAgentConfig('agent-2', config2);

    const configs = await store.listAgentConfigs();
    expect(configs).toHaveLength(2);
  });

  it('should use atomic write (temp file + rename)', async () => {
    const config = {
      name: 'atomic-test',
      model: { provider: 'openai' as const, model: 'gpt-4o' },
      maxSteps: 10,
      streaming: false,
      parallelToolCalls: true,
      tools: [] as string[],
    };

    await store.saveAgentConfig('atomic-test', config);

    // Verify no .tmp file remains (atomic rename succeeded)
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(tmpDir);
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);

    // Verify the actual file exists
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    expect(jsonFiles).toHaveLength(1);
  });
});