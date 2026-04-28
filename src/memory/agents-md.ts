/**
 * AgentForge AGENTS.md Auto-Discovery
 *
 * Walks up from cwd to root, collecting AGENTS.md files.
 * Reverses order so root-level context comes first (project-level overrides global).
 *
 * @module
 */

import { readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';

// ============================================================
// Types
// ============================================================

/**
 * Configuration for AGENTS.md auto-discovery.
 */
export interface AgentsMdConfig {
  /** Starting directory (default: process.cwd()) */
  cwd?: string;

  /** File name to search for (default: 'AGENTS.md') */
  filename?: string;

  /** Max traversal depth (default: 10) */
  maxDepth?: number;

  /** Max content size in bytes per file (default: 50KB) */
  maxSize?: number;
}

/**
 * Result of AGENTS.md auto-discovery.
 */
export interface AgentsMdResult {
  /** Discovered file paths (root first, cwd last) */
  paths: string[];

  /** Merged content (root first, cwd last, separated by ---) */
  content: string;

  /** Estimated token count (content.length / 4) */
  estimatedTokens: number;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_FILENAME = 'AGENTS.md';
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_SIZE = 50 * 1024; // 50KB

// ============================================================
// Main Function
// ============================================================

/**
 * Auto-discover AGENTS.md files by walking up from cwd to root.
 *
 * Algorithm:
 * 1. Start at cwd, check for filename
 * 2. Walk up to parent directory
 * 3. Repeat until root or maxDepth reached
 * 4. Reverse order: root first, cwd last
 * 5. Merge content with separator
 *
 * @param config - Discovery configuration
 * @returns Discovered paths, merged content, and estimated tokens
 */
export async function loadAgentsMd(config: AgentsMdConfig = {}): Promise<AgentsMdResult> {
  const {
    cwd = process.cwd(),
    filename = DEFAULT_FILENAME,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxSize = DEFAULT_MAX_SIZE,
  } = config;

  const paths: string[] = [];
  const contents: string[] = [];
  let currentDir = cwd;
  let depth = 0;

  while (depth < maxDepth) {
    const filePath = join(currentDir, filename);

    try {
      const fileStat = await stat(filePath);
      // Only process regular files
      if (fileStat.isFile()) {
        const content = await readFile(filePath, 'utf-8');

        if (content.length <= maxSize) {
          paths.push(filePath);
          contents.push(content);
        }
      }
    } catch {
      // File doesn't exist or is inaccessible, continue walking up
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break; // Reached filesystem root
    currentDir = parentDir;
    depth++;
  }

  // Reverse: root first, cwd last (so project-level overrides global)
  paths.reverse();
  contents.reverse();

  const mergedContent = contents.join('\n\n---\n\n');

  return {
    paths,
    content: mergedContent,
    estimatedTokens: estimateTokens(mergedContent),
  };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Estimate token count from text content.
 * Uses simple heuristic: ~4 characters per token.
 *
 * @param text - Text content
 * @returns Estimated token count
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}