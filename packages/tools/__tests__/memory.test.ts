import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  memoryStoreTool,
  memoryRetrieveTool,
  memoryListTool,
  createMemoryTools,
  createInMemoryStore,
  type MemoryStore,
} from '../src/memory.js';

describe('memory tools', () => {
  describe('memoryStoreTool', () => {
    it('has correct name', () => {
      expect(memoryStoreTool.name).toBe('memory_store');
    });

    it('has description', () => {
      expect(memoryStoreTool.description).toBeDefined();
    });

    it('does not require approval by default', () => {
      expect(memoryStoreTool.requireApproval).toBe(false);
    });

    describe('inputSchema validation', () => {
      it('accepts key and value', () => {
        const schema = memoryStoreTool.inputSchema as z.ZodTypeAny;
        expect(schema.safeParse({ key: 'test', value: 'data' }).success).toBe(true);
      });

      it('rejects missing key', () => {
        const schema = memoryStoreTool.inputSchema as z.ZodTypeAny;
        expect(schema.safeParse({ value: 'data' }).success).toBe(false);
      });

      it('rejects missing value', () => {
        const schema = memoryStoreTool.inputSchema as z.ZodTypeAny;
        expect(schema.safeParse({ key: 'test' }).success).toBe(false);
      });
    });
  });

  describe('memoryRetrieveTool', () => {
    it('has correct name', () => {
      expect(memoryRetrieveTool.name).toBe('memory_retrieve');
    });

    it('has description', () => {
      expect(memoryRetrieveTool.description).toBeDefined();
    });

    describe('inputSchema validation', () => {
      it('accepts key', () => {
        const schema = memoryRetrieveTool.inputSchema as z.ZodTypeAny;
        expect(schema.safeParse({ key: 'test' }).success).toBe(true);
      });

      it('rejects missing key', () => {
        const schema = memoryRetrieveTool.inputSchema as z.ZodTypeAny;
        expect(schema.safeParse({}).success).toBe(false);
      });
    });
  });

  describe('memoryListTool', () => {
    it('has correct name', () => {
      expect(memoryListTool.name).toBe('memory_list');
    });

    it('has description', () => {
      expect(memoryListTool.description).toBeDefined();
    });

    describe('inputSchema validation', () => {
      it('accepts empty object', () => {
        const schema = memoryListTool.inputSchema as z.ZodTypeAny;
        expect(schema.safeParse({}).success).toBe(true);
      });
    });
  });
});

describe('createInMemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = createInMemoryStore();
  });

  it('stores and retrieves values', async () => {
    await store.set('key1', 'value1');
    const result = await store.get('key1');
    expect(result).toBe('value1');
  });

  it('returns undefined for missing keys', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('overwrites existing values', async () => {
    await store.set('key1', 'value1');
    await store.set('key1', 'value2');
    const result = await store.get('key1');
    expect(result).toBe('value2');
  });

  it('lists all entries', async () => {
    await store.set('key1', 'value1');
    await store.set('key2', 'value2');

    const items = await store.list();
    expect(items).toHaveLength(2);
    expect(items).toContainEqual({ key: 'key1', value: 'value1' });
    expect(items).toContainEqual({ key: 'key2', value: 'value2' });
  });

  it('returns empty list when store is empty', async () => {
    const items = await store.list();
    expect(items).toHaveLength(0);
  });
});

describe('createMemoryTools', () => {
  it('creates tools with default store', () => {
    const { storeTool, retrieveTool, listTool } = createMemoryTools();
    expect(storeTool.name).toBe('memory_store');
    expect(retrieveTool.name).toBe('memory_retrieve');
    expect(listTool.name).toBe('memory_list');
  });

  it('creates tools with custom store', async () => {
    const customStore: MemoryStore = {
      set: async () => {},
      get: async () => 'custom-value',
      list: async () => [{ key: 'custom', value: 'custom-value' }],
    };

    const { retrieveTool } = createMemoryTools({ store: customStore });
    const result = await retrieveTool.execute({ key: 'any' });
    expect(result.value).toBe('custom-value');
  });

  describe('integration with store', () => {
    it('stores and retrieves value', async () => {
      const { storeTool, retrieveTool } = createMemoryTools();
      await storeTool.execute({ key: 'test-key', value: 'test-value' });
      const result = await retrieveTool.execute({ key: 'test-key' });
      expect(result.value).toBe('test-value');
    });

    it('lists stored entries', async () => {
      const { storeTool, listTool } = createMemoryTools();
      await storeTool.execute({ key: 'key-a', value: 'value-a' });
      await storeTool.execute({ key: 'key-b', value: 'value-b' });

      const result = await listTool.execute({});
      expect(result.items).toHaveLength(2);
    });
  });

  describe('renderCall and renderResult', () => {
    const { storeTool, retrieveTool, listTool } = createMemoryTools();

    it('storeTool renders correctly', () => {
      expect(storeTool.renderCall({ key: 'test', value: 'data' })).toBe('memory_store("test", ...)');
      expect(storeTool.renderResult({ success: true })).toBe('Stored');
    });

    it('retrieveTool renders correctly', () => {
      expect(retrieveTool.renderCall({ key: 'test' })).toBe('memory_retrieve("test")');
      expect(retrieveTool.renderResult({ value: 'data' })).toBe('data');
      expect(retrieveTool.renderResult({ value: undefined })).toBe('Not found');
    });

    it('listTool renders correctly', () => {
      expect(listTool.renderCall({})).toBe('memory_list()');
      expect(listTool.renderResult({ items: [{ key: 'a', value: 'b' }] })).toBe('1 items');
    });
  });
});
