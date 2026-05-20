import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { webSearchTool, createWebSearchTool } from '../src/web-search.js';

describe('webSearchTool', () => {
  describe('metadata', () => {
    it('has correct name', () => {
      expect(webSearchTool.name).toBe('web_search');
    });

    it('has description', () => {
      expect(webSearchTool.description).toBeDefined();
    });

    it('has inputSchema', () => {
      expect(webSearchTool.inputSchema).toBeDefined();
    });

    it('has outputSchema', () => {
      expect(webSearchTool.outputSchema).toBeDefined();
    });

    it('does not require approval by default', () => {
      expect(webSearchTool.requireApproval).toBe(false);
    });
  });

  describe('inputSchema validation', () => {
    it('accepts query string', () => {
      const schema = webSearchTool.inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({ query: 'test' }).success).toBe(true);
    });

    it('accepts optional maxResults', () => {
      const schema = webSearchTool.inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({ query: 'test', maxResults: 10 }).success).toBe(true);
    });

    it('rejects missing query', () => {
      const schema = webSearchTool.inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({}).success).toBe(false);
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns search results', async () => {
      const mockResponse = {
        RelatedTopics: [
          { Text: 'Result 1 - A description', FirstURL: 'https://example.com/1' },
          { Text: 'Result 2 - Another description', FirstURL: 'https://example.com/2' },
        ],
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await webSearchTool.execute({ query: 'test query' });

      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        title: 'Result 1',
        url: 'https://example.com/1',
      });
    });

    it('respects maxResults parameter', async () => {
      const mockResponse = {
        RelatedTopics: [
          { Text: 'Result 1', FirstURL: 'https://example.com/1' },
          { Text: 'Result 2', FirstURL: 'https://example.com/2' },
          { Text: 'Result 3', FirstURL: 'https://example.com/3' },
        ],
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await webSearchTool.execute({ query: 'test', maxResults: 2 });

      expect(result.results).toHaveLength(2);
    });

    it('handles empty results', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        json: () => Promise.resolve({ RelatedTopics: [] }),
      } as Response);

      const result = await webSearchTool.execute({ query: 'nonexistent' });

      expect(result.results).toHaveLength(0);
    });

    it('filters out entries without Text or FirstURL', async () => {
      const mockResponse = {
        RelatedTopics: [
          { Text: 'Valid result', FirstURL: 'https://example.com/1' },
          { Text: 'Missing URL' },
          { FirstURL: 'https://example.com/2' },
          {},
        ],
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await webSearchTool.execute({ query: 'test' });

      expect(result.results).toHaveLength(1);
    });

    it('encodes query in URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        json: () => Promise.resolve({ RelatedTopics: [] }),
      } as Response);

      await webSearchTool.execute({ query: 'hello world&param=value' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('hello%20world%26param%3Dvalue')
      );
    });
  });

  describe('createWebSearchTool', () => {
    it('creates tool with custom options', () => {
      const tool = createWebSearchTool({ provider: 'duckduckgo' });
      expect(tool.name).toBe('web_search');
    });
  });

  describe('renderCall', () => {
    it('renders call with query', () => {
      const rendered = webSearchTool.renderCall({ query: 'test query' });
      expect(rendered).toBe('web_search("test query")');
    });
  });

  describe('renderResult', () => {
    it('renders result count', () => {
      const rendered = webSearchTool.renderResult({ results: [{ title: 'A', url: 'B', snippet: 'C' }] });
      expect(rendered).toBe('Found 1 results');
    });
  });
});
