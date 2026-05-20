import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { webFetchTool, createWebFetchTool } from '../src/web-fetch.js';

describe('webFetchTool', () => {
  describe('metadata', () => {
    it('has correct name', () => {
      expect(webFetchTool.name).toBe('web_fetch');
    });

    it('has description', () => {
      expect(webFetchTool.description).toBeDefined();
    });

    it('has inputSchema', () => {
      expect(webFetchTool.inputSchema).toBeDefined();
    });

    it('has outputSchema', () => {
      expect(webFetchTool.outputSchema).toBeDefined();
    });

    it('does not require approval by default', () => {
      expect(webFetchTool.requireApproval).toBe(false);
    });
  });

  describe('inputSchema validation', () => {
    it('accepts valid URL', () => {
      const schema = webFetchTool.inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({ url: 'https://example.com' }).success).toBe(true);
    });

    it('accepts optional maxLength', () => {
      const schema = webFetchTool.inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({ url: 'https://example.com', maxLength: 5000 }).success).toBe(true);
    });

    it('rejects invalid URL', () => {
      const schema = webFetchTool.inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({ url: 'not-a-url' }).success).toBe(false);
    });

    it('rejects missing URL', () => {
      const schema = webFetchTool.inputSchema as z.ZodTypeAny;
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

    it('fetches and extracts content from URL', async () => {
      const mockHtml = `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <script>console.log('script')</script>
            <style>.class { color: red; }</style>
            <p>Hello World</p>
          </body>
        </html>
      `;

      vi.mocked(fetch).mockResolvedValueOnce({
        text: () => Promise.resolve(mockHtml),
        status: 200,
      } as Response);

      const result = await webFetchTool.execute({ url: 'https://example.com' });

      expect(result.status).toBe(200);
      expect(result.title).toBe('Test Page');
      expect(result.content).toContain('Hello World');
      expect(result.content).not.toContain('script');
      expect(result.content).not.toContain('style');
    });

    it('extracts title from HTML', async () => {
      const mockHtml = '<html><head><title>  My Title  </title></head><body>Content</body></html>';

      vi.mocked(fetch).mockResolvedValueOnce({
        text: () => Promise.resolve(mockHtml),
        status: 200,
      } as Response);

      const result = await webFetchTool.execute({ url: 'https://example.com' });

      expect(result.title).toBe('My Title');
    });

    it('truncates content to maxLength', async () => {
      const longContent = 'A'.repeat(20000);
      const mockHtml = `<html><body>${longContent}</body></html>`;

      vi.mocked(fetch).mockResolvedValueOnce({
        text: () => Promise.resolve(mockHtml),
        status: 200,
      } as Response);

      const result = await webFetchTool.execute({ url: 'https://example.com', maxLength: 100 });

      expect(result.content.length).toBeLessThan(150); // 100 + '... [truncated]'
      expect(result.content).toContain('[truncated]');
    });

    it('handles pages without title', async () => {
      const mockHtml = '<html><body>Just content</body></html>';

      vi.mocked(fetch).mockResolvedValueOnce({
        text: () => Promise.resolve(mockHtml),
        status: 200,
      } as Response);

      const result = await webFetchTool.execute({ url: 'https://example.com' });

      expect(result.title).toBeUndefined();
      expect(result.content).toContain('Just content');
    });

    it('returns HTTP status code', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        text: () => Promise.resolve('<html><body>Not Found</body></html>'),
        status: 404,
      } as Response);

      const result = await webFetchTool.execute({ url: 'https://example.com/notfound' });

      expect(result.status).toBe(404);
    });
  });

  describe('createWebFetchTool', () => {
    it('creates tool with custom timeout', () => {
      const tool = createWebFetchTool({ timeout: 5000 });
      expect(tool.name).toBe('web_fetch');
    });
  });

  describe('renderCall', () => {
    it('renders call with URL', () => {
      const rendered = webFetchTool.renderCall({ url: 'https://example.com' });
      expect(rendered).toBe('web_fetch("https://example.com")');
    });
  });

  describe('renderResult', () => {
    it('renders status and preview', () => {
      const rendered = webFetchTool.renderResult({ content: 'Test content here', status: 200 });
      expect(rendered).toContain('[200]');
      expect(rendered).toContain('Test content');
    });
  });
});
