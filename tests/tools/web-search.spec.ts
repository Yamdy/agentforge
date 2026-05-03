/**
 * WebSearchTool Tests
 *
 * Tests for the web-search tool: Exa API search with mock fallback,
 * parameter validation, timeout handling, and config management.
 *
 * TDD: Write tests FIRST, watch them fail, then implement.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import type { ToolDefinition } from '../../src/core/interfaces.js';

// Stub global fetch for testing
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

// Cached factory — imported once in beforeAll
let createWebSearchTool: () => ToolDefinition[];

beforeAll(async () => {
  const mod = await import('../../src/tools/web-search.js');
  createWebSearchTool = mod.createWebSearchTool;
});

describe('WebSearchTool', () => {
  let searchTools: ToolDefinition[];

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // Tool Creation & Metadata
  // ============================================================

  describe('tool creation', () => {
    it('should return an array of tool definitions', async () => {
      searchTools = createWebSearchTool();

      expect(Array.isArray(searchTools)).toBe(true);
      expect(searchTools.length).toBeGreaterThanOrEqual(1);
    });

    it('should have correct tool name', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      expect(tool.name).toBe('web_search');
    });

    it('should have a non-empty description', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(0);
    });

    it('should have Zod schema for parameters', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      expect(tool.parameters).toBeDefined();
      expect(typeof (tool.parameters as { parse?: unknown }).parse).toBe(
        'function'
      );
    });

    it('should not require approval by default', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      expect(tool.requiresApproval).toBeUndefined();
    });
  });

  // ============================================================
  // Parameter Validation (Zod Schema)
  // ============================================================

  describe('parameter validation', () => {
    it('should accept valid query with default numResults', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      const result = await tool.execute({ query: 'TypeScript tutorials' });

      // Should NOT be a validation error
      expect(result).not.toContain('Invalid');
    });

    it('should reject missing query field', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      const result = await tool.execute({});

      expect(result).toContain('Error');
      expect(result).toMatch(/query/i);
    });

    it('should reject empty query string', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      const result = await tool.execute({ query: '' });

      expect(result).toContain('Error');
      expect(result).toMatch(/query|string/i);
    });

    it('should reject numResults below 1', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      const result = await tool.execute({
        query: 'test',
        numResults: 0,
      });

      expect(result).toContain('Error');
    });

    it('should reject numResults above 20', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      const result = await tool.execute({
        query: 'test',
        numResults: 21,
      });

      expect(result).toContain('Error');
    });

    it('should accept numResults within valid range', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      const result = await tool.execute({
        query: 'test',
        numResults: 3,
      });

      expect(result).not.toContain('Invalid');
    });

    it('should default numResults to 5 when omitted', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ apiKey: 'test-key' });

      const tool = searchTools[0]!;

      // Set up mock Exa API response with 5 results
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [
            { title: 'R1', url: 'https://a.com', text: 'S1' },
            { title: 'R2', url: 'https://b.com', text: 'S2' },
            { title: 'R3', url: 'https://c.com', text: 'S3' },
            { title: 'R4', url: 'https://d.com', text: 'S4' },
            { title: 'R5', url: 'https://e.com', text: 'S5' },
          ],
        }),
      } as unknown as Response);

      await tool.execute({ query: 'test' });

      // Verify the body sent to Exa has numResults: 5 (default)
      const fetchCall = mockFetch.mock.calls[0];
      const body = fetchCall?.[1]?.body as string | undefined;
      expect(body).toBeDefined();
      const parsed = JSON.parse(body!);
      expect(parsed.numResults).toBe(5);
    });
  });

  // ============================================================
  // Mock Mode (No API Key)
  // ============================================================

  describe('mock mode', () => {
    it('should return placeholder when no API key configured', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      const result = await tool.execute({ query: 'test query' });

      expect(result).toContain('mock');
      expect(result).toMatch(/no.*provider|not.*configured/i);
    });

    it('should NOT make real HTTP calls in mock mode', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      await tool.execute({ query: 'anything' });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should still validate input in mock mode', async () => {
      searchTools = createWebSearchTool();

      const tool = searchTools[0]!;
      const result = await tool.execute({});

      expect(result).toContain('Error');
    });

    it('should use mock mode when provider is explicitly mock', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ provider: 'mock' });

      const tool = searchTools[0]!;
      const result = await tool.execute({ query: 'test' });

      expect(result).toContain('mock');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Config Handling
  // ============================================================

  describe('config handling', () => {
    it('should store API key from config', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      // The tool should work with an API key (i.e., not fall to mock)
      searchTools = createWebSearchTool({ apiKey: 'exa-key-123' });

      const tool = searchTools[0]!;

      // Mock a valid Exa response
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [{ title: 'Test', url: 'https://test.com', text: 'Snippet' }],
        }),
      } as unknown as Response);

      const result = await tool.execute({ query: 'test' });
      // Should NOT be mock placeholder
      expect(result).not.toContain('mock');
    });

    it('should use Exa API when provider is exa and API key provided', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({
        provider: 'exa',
        apiKey: 'exa-key-456',
      });

      const tool = searchTools[0]!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [{ title: 'T', url: 'https://u.com', text: 'S' }],
        }),
      } as unknown as Response);

      await tool.execute({ query: 'search this' });

      // Verify correct Exa API call
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.exa.ai/search');
      expect(init!.method).toBe('POST');
      const headers = init!.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('exa-key-456');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should fall back to mock when provider is exa but no API key', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ provider: 'exa' });

      const tool = searchTools[0]!;
      const result = await tool.execute({ query: 'test' });

      expect(result).toContain('mock');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Exa API Response Formatting
  // ============================================================

  describe('response formatting', () => {
    it('should format Exa results as [N] Title\\nURL\\nSnippet', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ apiKey: 'key' });

      const tool = searchTools[0]!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [
            {
              title: 'TypeScript Docs',
              url: 'https://typescriptlang.org',
              text: 'Official TypeScript documentation',
            },
            {
              title: 'TS Handbook',
              url: 'https://typescriptlang.org/handbook',
              text: 'The TypeScript Handbook',
            },
          ],
        }),
      } as unknown as Response);

      const result = await tool.execute({ query: 'typescript' });

      expect(result).toContain('[1]');
      expect(result).toContain('TypeScript Docs');
      expect(result).toContain('https://typescriptlang.org');
      expect(result).toContain('Official TypeScript documentation');
      expect(result).toContain('[2]');
      expect(result).toContain('TS Handbook');

      // Each result separated by one blank line
      const lines = result.split('\n');
      const blankLineCount = lines.filter((l) => l === '').length;
      expect(blankLineCount).toBeGreaterThanOrEqual(1);
    });

    it('should handle results with missing fields gracefully', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ apiKey: 'key' });

      const tool = searchTools[0]!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [
            { title: 'Only Title' },
            // missing url and text
          ],
        }),
      } as unknown as Response);

      const result = await tool.execute({ query: 'test' });
      expect(result).toContain('[1]');
      expect(result).toContain('Only Title');
    });

    it('should return empty results message when no results', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ apiKey: 'key' });

      const tool = searchTools[0]!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [],
        }),
      } as unknown as Response);

      const result = await tool.execute({ query: 'nothing matches this' });
      expect(result).toMatch(/no results|empty/i);
    });
  });

  // ============================================================
  // Error Handling
  // ============================================================

  describe('error handling', () => {
    it('should return error when API response is not ok', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ apiKey: 'key' });

      const tool = searchTools[0]!;

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue('Invalid API key'),
      } as unknown as Response);

      const result = await tool.execute({ query: 'test' });
      expect(result).toContain('Error');
      expect(result).toMatch(/401|Unauthorized|api key/i);
    });

    it('should return error on network failure', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ apiKey: 'key' });

      const tool = searchTools[0]!;

      mockFetch.mockRejectedValue(new Error('Network error'));
      const result = await tool.execute({ query: 'test' });

      expect(result).toContain('Error');
      expect(result).toMatch(/network|failed/i);
    });

    it('should handle invalid JSON response', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ apiKey: 'key' });

      const tool = searchTools[0]!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as unknown as Response);

      const result = await tool.execute({ query: 'test' });
      expect(result).toContain('Error');
    });

    it('should return error when API response missing results field', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ apiKey: 'key' });

      const tool = searchTools[0]!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ unexpectedField: true }),
      } as unknown as Response);

      const result = await tool.execute({ query: 'test' });
      expect(result).toContain('Error');
    });
  });

  // ============================================================
  // Timeout Handling
  // ============================================================

  describe('timeout handling', () => {
    it('should abort request after configured timeout', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({
        apiKey: 'key',
        timeout: 100,
      });

      const tool = searchTools[0]!;

      // Create a fetch that triggers abort
      mockFetch.mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              signal.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            }
          })
      );

      const result = await tool.execute({ query: 'test' });

      expect(result).toContain('Error');
      expect(result).toMatch(/timed out|abort/i);
    });

    it('should use default timeout when not configured', async () => {
      const { createWebSearchTool } = await import(
        '../../src/tools/web-search.js'
      );
      searchTools = createWebSearchTool({ apiKey: 'key' });

      const tool = searchTools[0]!;

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [{ title: 'T', url: 'https://u.com', text: 'S' }],
        }),
      } as unknown as Response);

      await tool.execute({ query: 'test' });

      const fetchCall = mockFetch.mock.calls[0];
      const init = fetchCall?.[1] as RequestInit | undefined;
      expect(init?.signal).toBeDefined();
    });
  });
});
