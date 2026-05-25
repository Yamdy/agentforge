import { describe, it, expect } from 'vitest';
import { jsonTool } from '../src/json.js';

describe('json tool', () => {
  describe('parse operation', () => {
    it('parses valid JSON and formats with indent', async () => {
      const result = await jsonTool.execute({ operation: 'parse', data: '{"name":"test","value":42}' });
      expect(result.result).toBe(JSON.stringify({ name: 'test', value: 42 }, null, 2));
    });

    it('throws on invalid JSON', async () => {
      await expect(jsonTool.execute({ operation: 'parse', data: 'not json' })).rejects.toThrow();
    });
  });

  describe('stringify operation', () => {
    it('re-formats valid JSON input', async () => {
      const result = await jsonTool.execute({ operation: 'stringify', data: '{"name":"test"}' });
      expect(result.result).toBe(JSON.stringify({ name: 'test' }, null, 2));
    });

    it('converts key=value pairs to JSON object', async () => {
      const result = await jsonTool.execute({ operation: 'stringify', data: 'name=test value=42 active=true' });
      const parsed = JSON.parse(result.result);
      expect(parsed).toEqual({ name: 'test', value: '42', active: 'true' });
    });

    it('wraps unstructured text in a value object', async () => {
      const result = await jsonTool.execute({ operation: 'stringify', data: 'hello world' });
      const parsed = JSON.parse(result.result);
      expect(parsed).toEqual({ value: 'hello world' });
    });

    it('respects custom indent', async () => {
      const result = await jsonTool.execute({ operation: 'stringify', data: '{"a":1}', indent: 4 }, {});
      expect(result.result).toBe(JSON.stringify({ a: 1 }, null, 4));
    });

    it('handles key=value pairs with quoted values', async () => {
      const result = await jsonTool.execute({ operation: 'stringify', data: 'msg="hello world" count=5' });
      const parsed = JSON.parse(result.result);
      expect(parsed).toEqual({ msg: 'hello world', count: '5' });
    });
  });

  describe('query operation', () => {
    it('queries nested path', async () => {
      const result = await jsonTool.execute({ operation: 'query', data: '{"users":[{"name":"alice"}]}', path: 'users.0.name' });
      expect(JSON.parse(result.result)).toBe('alice');
    });
  });
});
