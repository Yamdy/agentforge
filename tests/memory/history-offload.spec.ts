/**
 * Unit tests for src/memory/history-offload.ts
 *
 * Tests HistoryOffloadManager with offload, load, disabled mode, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { HistoryOffloadManager } from '../../src/memory/history-offload.js';
import type { Message } from '../../src/core/events.js';

// ============================================================
// Test Helpers
// ============================================================

function createMessages(): Message[] {
  return [
    { role: 'user', content: 'What is the weather?' },
    { role: 'assistant', content: 'It is sunny today.' },
  ];
}

function createMessagesWithSystem(): Message[] {
  return [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'tool', content: 'result', toolCallId: 'call_1', name: 'test' },
  ];
}

// ============================================================
// HistoryOffloadManager Tests
// ============================================================

describe('HistoryOffloadManager', () => {
  let manager: HistoryOffloadManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `history-offload-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  // ── Construction ──

  describe('construction', () => {
    it('should create with default config', () => {
      manager = new HistoryOffloadManager();
      expect(manager).toBeDefined();
    });

    it('should create with custom config', () => {
      manager = new HistoryOffloadManager({ historyDir: tempDir });
      expect(manager).toBeDefined();
    });
  });

  // ── offload ──

  describe('offload', () => {
    beforeEach(() => {
      manager = new HistoryOffloadManager({ historyDir: tempDir });
    });

    it('should write messages as markdown file', async () => {
      const filePath = await manager.offload('session-1', createMessages());
      expect(filePath).toBeTruthy();
      const content = await readFile(filePath!, 'utf-8');
      expect(content).toContain('[user]: What is the weather?');
      expect(content).toContain('[assistant]: It is sunny today.');
    });

    it('should include timestamp header', async () => {
      const filePath = await manager.offload('session-1', createMessages());
      const content = await readFile(filePath!, 'utf-8');
      expect(content).toContain('## Summarized at');
    });

    it('should append to existing file', async () => {
      await manager.offload('session-1', [{ role: 'user', content: 'First message' }]);
      await manager.offload('session-1', [{ role: 'assistant', content: 'Second message' }]);
      const content = await manager.load('session-1');
      expect(content).toContain('First message');
      expect(content).toContain('Second message');
      // Count timestamp headers
      const headers = (content?.match(/## Summarized at/g) ?? []).length;
      expect(headers).toBe(2);
    });

    it('should filter out system messages', async () => {
      const filePath = await manager.offload('session-1', createMessagesWithSystem());
      const content = await readFile(filePath!, 'utf-8');
      expect(content).not.toContain('[system]');
      expect(content).toContain('[user]: Hello');
      expect(content).toContain('[tool (test)]: result');
    });

    it('should return null when messages array is empty', async () => {
      const result = await manager.offload('session-1', []);
      expect(result).toBeNull();
    });

    it('should return null when disabled', async () => {
      const disabled = new HistoryOffloadManager({ enabled: false, historyDir: tempDir });
      const result = await disabled.offload('session-1', createMessages());
      expect(result).toBeNull();
    });

    it('should use custom filenameTemplate', async () => {
      const custom = new HistoryOffloadManager({
        historyDir: tempDir,
        filenameTemplate: '{sessionId}-history.md',
      });
      const filePath = await custom.offload('my-session', createMessages());
      expect(filePath).toContain('my-session-history.md');
    });
  });

  // ── load ──

  describe('load', () => {
    beforeEach(() => {
      manager = new HistoryOffloadManager({ historyDir: tempDir });
    });

    it('should return null when file does not exist', async () => {
      const result = await manager.load('non-existent');
      expect(result).toBeNull();
    });

    it('should return file content after offload', async () => {
      await manager.offload('session-1', createMessages());
      const content = await manager.load('session-1');
      expect(content).toBeTruthy();
      expect(content).toContain('What is the weather?');
    });

    it('should return full accumulated content after multiple offload calls', async () => {
      await manager.offload('session-1', [{ role: 'user', content: 'Hello' }]);
      await manager.offload('session-1', [{ role: 'assistant', content: 'World' }]);
      const content = await manager.load('session-1');
      expect(content).toContain('Hello');
      expect(content).toContain('World');
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('should handle directory creation automatically', async () => {
      const nestedDir = join(tempDir, 'nested', 'path');
      manager = new HistoryOffloadManager({ historyDir: nestedDir });
      const filePath = await manager.offload('session-1', createMessages());
      expect(filePath).toBeTruthy();
      const content = await readFile(filePath!, 'utf-8');
      expect(content).toContain('[user]');
    });

    it('should handle special characters in session IDs', async () => {
      manager = new HistoryOffloadManager({ historyDir: tempDir });
      const filePath = await manager.offload('session/with:special*chars', createMessages());
      expect(filePath).toBeTruthy();
    });

    it('should handle messages with tool call IDs', async () => {
      manager = new HistoryOffloadManager({ historyDir: tempDir });
      const msgs: Message[] = [
        { role: 'tool', content: 'result', toolCallId: 'call_abc123', name: 'search' },
      ];
      const filePath = await manager.offload('session-1', msgs);
      const content = await readFile(filePath!, 'utf-8');
      expect(content).toContain('[tool (search)]');
    });
  });
});
