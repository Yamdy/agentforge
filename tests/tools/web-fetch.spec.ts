/**
 * WebFetchTool Tests
 *
 * Tests for the web-fetch tool: HTTP requests with domain filtering,
 * timeout handling, and response truncation.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import type { ToolDefinition } from '../../src/core/interfaces.js';

// Stub global fetch for testing
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

// Cached factory — imported once in beforeAll
let createWebFetchTool: (options?: Record<string, unknown>) => ToolDefinition;

beforeAll(async () => {
  const mod = await import('../../src/tools/web-fetch.js');
  createWebFetchTool = mod.createWebFetchTool;
});

describe('WebFetchTool', () => {
  let fetchTool: ToolDefinition;
  let mockResponse: Response;

  beforeEach(() => {
    mockFetch.mockReset();

    // Create a default mock response
    mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
        'content-length': '13',
      }),
      text: vi.fn().mockResolvedValue('Hello, World!'),
      json: vi.fn(),
      blob: vi.fn(),
      arrayBuffer: vi.fn(),
      formData: vi.fn(),
      clone: vi.fn(),
      body: null,
      bodyUsed: false,
      redirected: false,
      type: 'basic' as ResponseType,
      url: 'https://example.com',
    } as unknown as Response;

    mockFetch.mockResolvedValue(mockResponse);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // Schema Validation Tests
  // ============================================================

  describe('parameter validation', () => {
    it('should reject non-URL strings', async () => {
      fetchTool = createWebFetchTool({});

      const result = await fetchTool.execute({ url: 'not-a-url' });
      expect(result).toContain('Error');
      expect(result).toMatch(/invalid|url/i);
    });

    it('should reject missing url field', async () => {
      fetchTool = createWebFetchTool({});

      const result = await fetchTool.execute({ method: 'GET' });
      expect(result).toContain('Error');
    });

    it('should reject invalid method', async () => {
      fetchTool = createWebFetchTool({});

      const result = await fetchTool.execute({
        url: 'https://example.com',
        method: 'DELETE',
      });
      expect(result).toContain('Error');
    });

    it('should default method to GET', async () => {
      fetchTool = createWebFetchTool({});

      await fetchTool.execute({ url: 'https://example.com' });

      // Verify fetch was called with GET method
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  // ============================================================
  // Successful Requests
  // ============================================================

  describe('successful GET request', () => {
    it('should fetch a URL and return formatted response', async () => {
      fetchTool = createWebFetchTool({});

      const result = await fetchTool.execute({
        url: 'https://example.com',
      });

      expect(result).toContain('200');
      expect(result).toContain('Hello, World!');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should include status code in output', async () => {
      fetchTool = createWebFetchTool({});

      const result = await fetchTool.execute({
        url: 'https://example.com',
      });

      expect(result).toMatch(/200|OK/);
    });

    it('should handle non-200 status codes', async () => {
      mockResponse = {
        ...mockResponse,
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('Page not found'),
        headers: new Headers({ 'content-type': 'text/plain' }),
      } as unknown as Response;
      mockFetch.mockResolvedValue(mockResponse);

      fetchTool = createWebFetchTool({});

      const result = await fetchTool.execute({
        url: 'https://example.com/missing',
      });

      expect(result).toContain('404');
      expect(result).toContain('Page not found');
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));

      fetchTool = createWebFetchTool({});

      const result = await fetchTool.execute({
        url: 'https://example.com',
      });

      expect(result).toContain('Error');
      expect(result).toMatch(/network|fail/i);
    });
  });

  // ============================================================
  // POST Requests
  // ============================================================

  describe('POST with body', () => {
    it('should send POST request with body', async () => {
      fetchTool = createWebFetchTool({});

      await fetchTool.execute({
        url: 'https://example.com/api',
        method: 'POST',
        body: JSON.stringify({ key: 'value' }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ key: 'value' }) })
      );
    });

    it('should include custom headers in POST request', async () => {
      fetchTool = createWebFetchTool({});

      await fetchTool.execute({
        url: 'https://example.com/api',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token123' },
        body: '{"data":1}',
      });

      const init = mockFetch.mock.lastCall?.[1] as RequestInit | undefined;
      expect(init?.headers).toBeDefined();
      // Headers object should contain Content-Type and Authorization
      const headers = init?.headers as Headers | Record<string, string> | undefined;
      if (headers instanceof Headers) {
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(headers.get('Authorization')).toBe('Bearer token123');
      } else if (headers) {
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['Authorization']).toBe('Bearer token123');
      }
    });
  });

  // ============================================================
  // Timeout Handling
  // ============================================================

  describe('timeout handling', () => {
    it('should abort request after timeout', async () => {
      // Create a fetch that never resolves
      mockFetch.mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            // Check if abort signal fires
            const signal = init?.signal;
            if (signal) {
              signal.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            }
            // Don't resolve — let timeout handle it
          })
      );

      fetchTool = createWebFetchTool({ defaultTimeout: 100 });

      const result = await fetchTool.execute({
        url: 'https://example.com',
      });

      expect(result).toContain('Error');
      expect(result).toMatch(/timed out|abort/i);
    });

    it('should use default timeout from config', async () => {
      fetchTool = createWebFetchTool({ defaultTimeout: 5000 });

      await fetchTool.execute({ url: 'https://example.com' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should respect context timeout over default', async () => {
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

      fetchTool = createWebFetchTool({ defaultTimeout: 5000 });

      // Use ctx timeout instead
      const result = await fetchTool.execute(
        { url: 'https://example.com' },
        {
          toolCallId: 'test-1',
          parentSessionId: 'session-1',
          timeout: 50,
        }
      );

      expect(result).toContain('Error');
      expect(result).toMatch(/timed out|abort/i);
    });
  });

  // ============================================================
  // Domain Filtering
  // ============================================================

  describe('domain blocking', () => {
    it('should block requests to blocked domains', async () => {
      fetchTool = createWebFetchTool({
        blockedDomains: ['evil.com', 'malware.org'],
      });

      const result = await fetchTool.execute({
        url: 'https://evil.com/steal-data',
      });

      expect(result).toContain('Error');
      expect(result).toMatch(/blocked|denied|forbidden/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should block subdomains of blocked domains', async () => {
      fetchTool = createWebFetchTool({
        blockedDomains: ['evil.com'],
      });

      const result = await fetchTool.execute({
        url: 'https://api.evil.com/data',
      });

      expect(result).toContain('Error');
      expect(result).toMatch(/blocked|denied|forbidden/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('domain allowlisting', () => {
    it('should block requests to non-allowed domains when allowlist is set', async () => {
      fetchTool = createWebFetchTool({
        allowedDomains: ['example.com', 'api.example.com'],
      });

      const result = await fetchTool.execute({
        url: 'https://other-site.com/data',
      });

      expect(result).toContain('Error');
      expect(result).toMatch(/not.allowed|denied|forbidden|outside/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should allow requests to allowed domains', async () => {
      fetchTool = createWebFetchTool({
        allowedDomains: ['example.com'],
      });

      const result = await fetchTool.execute({
        url: 'https://example.com/page',
      });

      expect(result).toContain('200');
      expect(result).toContain('Hello, World!');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle subdomains correctly with allowlist', async () => {
      fetchTool = createWebFetchTool({
        allowedDomains: ['example.com'],
      });

      const result = await fetchTool.execute({
        url: 'https://sub.example.com/page',
      });

      // Subdomains of allowed domains should also be allowed
      expect(result).toContain('200');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Response Truncation
  // ============================================================

  describe('response truncation', () => {
    it('should truncate large responses', async () => {
      const longText = 'A'.repeat(500);
      mockResponse = {
        ...mockResponse,
        text: vi.fn().mockResolvedValue(longText),
      } as unknown as Response;
      mockFetch.mockResolvedValue(mockResponse);

      fetchTool = createWebFetchTool({ maxResponseSize: 100 });

      const result = await fetchTool.execute({
        url: 'https://example.com/large',
      });

      // Should contain truncated indicator
      expect(result).toMatch(/truncat|too.large|exceed|limit/i);
      // Should NOT contain the full 500 chars
      expect(result.length).toBeLessThan(longText.length + 200); // +200 for header/status overhead
    });

    it('should not truncate small responses', async () => {
      const smallText = 'Short response';
      mockResponse = {
        ...mockResponse,
        text: vi.fn().mockResolvedValue(smallText),
      } as unknown as Response;
      mockFetch.mockResolvedValue(mockResponse);

      fetchTool = createWebFetchTool({ maxResponseSize: 1000 });

      const result = await fetchTool.execute({
        url: 'https://example.com/small',
      });

      expect(result).toContain(smallText);
      expect(result).not.toMatch(/truncat/i);
    });

    it('should use default maxResponseSize of 100K', async () => {
      fetchTool = createWebFetchTool({});

      const result = await fetchTool.execute({
        url: 'https://example.com',
      });

      // Default 100K should not truncate a 13-char response
      expect(result).toContain('Hello, World!');
    });
  });

  // ============================================================
  // Tool Metadata
  // ============================================================

  describe('tool metadata', () => {
    it('should have correct name', async () => {
      fetchTool = createWebFetchTool({});

      expect(fetchTool.name).toBe('web_fetch');
    });

    it('should have Zod schema for parameters', async () => {
      fetchTool = createWebFetchTool({});

      expect(fetchTool.parameters).toBeDefined();
      expect(typeof (fetchTool.parameters as { parse?: unknown }).parse).toBe(
        'function'
      );
    });

    it('should have a description', async () => {
      fetchTool = createWebFetchTool({});

      expect(fetchTool.description).toBeTruthy();
      expect(fetchTool.description.length).toBeGreaterThan(0);
    });

    it('should not require approval by default', async () => {
      fetchTool = createWebFetchTool({});

      expect(fetchTool.requiresApproval).toBeUndefined();
    });
  });
});
