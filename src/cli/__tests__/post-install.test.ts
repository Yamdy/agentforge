/**
 * Tests for the post-install module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to create mocks that can be used in vi.mock factories
const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

// Mock node:child_process
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

// Mock chalk to return plain strings in tests
vi.mock('chalk', () => ({
  default: {
    blue: (s: string): string => s,
    green: (s: string): string => s,
    yellow: (s: string): string => s,
    cyan: (s: string): string => s,
    red: (s: string): string => s,
  },
}));

import { initGit, installDeps, formatWithPrettier, runPostInstall } from '../post-install.js';
import type { PromptsConfig } from '../config.js';
import { DEFAULT_CONFIG } from '../config.js';

// Suppress console output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('post-install', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initGit', () => {
    it('runs git init, add, and commit', () => {
      mockExecFileSync.mockReturnValue('');

      initGit('/tmp/test-project');

      expect(mockExecFileSync).toHaveBeenCalledTimes(3);
      expect(mockExecFileSync).toHaveBeenCalledWith('git', ['init'], {
        cwd: '/tmp/test-project',
        stdio: 'pipe',
      });
      expect(mockExecFileSync).toHaveBeenCalledWith('git', ['add', '.'], {
        cwd: '/tmp/test-project',
        stdio: 'pipe',
      });
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'Initial commit from create-agentforge', '--no-gpg-sign'],
        { cwd: '/tmp/test-project', stdio: 'pipe' }
      );
    });

    it('throws descriptive error when git init fails', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('git not found');
      });

      expect(() => initGit('/tmp/test-project')).toThrow(/git/);
    });

    it('throws descriptive error when git add fails', () => {
      mockExecFileSync
        .mockReturnValueOnce('') // git init succeeds
        .mockImplementation(() => {
          throw new Error('add failed');
        }); // git add fails

      expect(() => initGit('/tmp/test-project')).toThrow();
    });

    it('throws descriptive error when git commit fails', () => {
      mockExecFileSync
        .mockReturnValueOnce('') // git init succeeds
        .mockReturnValueOnce('') // git add succeeds
        .mockImplementation(() => {
          throw new Error('commit failed');
        }); // git commit fails

      expect(() => initGit('/tmp/test-project')).toThrow(/commit/);
    });
  });

  describe('installDeps', () => {
    it('runs npm install in target directory', () => {
      mockExecFileSync.mockReturnValue('');

      installDeps('/tmp/test-project');

      expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['install'], {
        cwd: '/tmp/test-project',
        stdio: 'pipe',
      });
    });

    it('throws descriptive error when npm install fails', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('npm install failed');
      });

      expect(() => installDeps('/tmp/test-project')).toThrow(/npm install/);
    });
  });

  describe('formatWithPrettier', () => {
    it('runs prettier --write on ts files', async () => {
      mockExecFileSync.mockReturnValue('');

      await formatWithPrettier('/tmp/test-project');

      expect(mockExecFileSync).toHaveBeenCalledWith('npx', ['prettier', '--write', 'src/**/*.ts'], {
        cwd: '/tmp/test-project',
        stdio: 'pipe',
      });
    });

    it('does not throw on prettier failure (best-effort)', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('prettier not found');
      });

      // Should resolve without throwing
      await expect(formatWithPrettier('/tmp/test-project')).resolves.toBeUndefined();
    });
  });

  describe('runPostInstall', () => {
    it('runs all steps when gitInit is true', async () => {
      mockExecFileSync.mockReturnValue('');
      const config: PromptsConfig = { ...DEFAULT_CONFIG, projectName: 'test', gitInit: true };

      await runPostInstall(config, '/tmp/test-project');

      // git init + git add + git commit + npm install + npx prettier = 5 calls
      expect(mockExecFileSync).toHaveBeenCalledTimes(5);
    });

    it('skips git init when gitInit is false', async () => {
      mockExecFileSync.mockReturnValue('');
      const config: PromptsConfig = { ...DEFAULT_CONFIG, projectName: 'test', gitInit: false };

      await runPostInstall(config, '/tmp/test-project');

      // Only npm install + npx prettier = 2 calls
      expect(mockExecFileSync).toHaveBeenCalledTimes(2);
      expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['install'], expect.any(Object));
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'npx',
        ['prettier', '--write', 'src/**/*.ts'],
        expect.any(Object)
      );
    });

    it('continues after prettier failure', async () => {
      mockExecFileSync
        .mockReturnValueOnce('') // git init
        .mockReturnValueOnce('') // git add
        .mockReturnValueOnce('') // git commit
        .mockReturnValueOnce('') // npm install
        .mockImplementation(() => {
          throw new Error('prettier failed');
        }); // prettier fails

      const config: PromptsConfig = { ...DEFAULT_CONFIG, projectName: 'test', gitInit: true };

      // Should resolve without throwing
      await expect(runPostInstall(config, '/tmp/test-project')).resolves.toBeUndefined();
    });

    it('throws when npm install fails', async () => {
      mockExecFileSync
        .mockReturnValueOnce('') // git init
        .mockReturnValueOnce('') // git add
        .mockReturnValueOnce('') // git commit
        .mockImplementation(() => {
          throw new Error('npm install failed');
        }); // npm install fails

      const config: PromptsConfig = { ...DEFAULT_CONFIG, projectName: 'test', gitInit: true };

      await expect(runPostInstall(config, '/tmp/test-project')).rejects.toThrow(/npm install/);
    });
  });
});
