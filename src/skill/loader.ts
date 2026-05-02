/**
 * AgentForge Skill Loader
 *
 * Handles loading SKILL.md files from filesystem and discovery.
 * All file operations return empty results on error (never throws).
 *
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import type { SkillInfo, SkillLoadResult, SkillDiscoveryOptions } from './types.js';
import { isSuccessfulLoadResult } from './types.js';
import { parseSkillFile } from './parser.js';
import type { SkillLoadHook } from './hooks.js';

// ============================================================
// Skill Loader Configuration
// ============================================================

/**
 * Skill loader configuration
 */
export interface SkillLoaderConfig {
  /** Default skill file name */
  skillFileName?: string;

  /** Hooks for skill loading lifecycle */
  hooks?: SkillLoadHook[];

  /** Enable logging */
  debug?: boolean;
}

const DEFAULT_CONFIG: Required<SkillLoaderConfig> = {
  skillFileName: 'SKILL.md',
  hooks: [],
  debug: false,
};

// ============================================================
// Single Skill Loading
// ============================================================

/**
 * Load a single skill from file path
 *
 * @param filePath - Absolute path to SKILL.md file
 * @param config - Loader configuration
 * @returns Load result (success or error)
 */
export async function loadSkill(
  filePath: string,
  config: SkillLoaderConfig = {}
): Promise<SkillLoadResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    // Read file
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);

    // Parse skill file
    const parseResult = parseSkillFile(content);

    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.message,
        filePath,
      };
    }

    let skillInfo: SkillInfo = {
      frontmatter: parseResult.data.frontmatter,
      content: parseResult.data.content,
      location: resolve(filePath),
      updatedAt: stats.mtime,
    };

    // Run after hooks
    for (const hook of cfg.hooks) {
      if (hook.afterLoad) {
        try {
          const modified = await hook.afterLoad(skillInfo);
          if (modified) {
            skillInfo = {
              ...skillInfo,
              frontmatter: modified.frontmatter ?? skillInfo.frontmatter,
              content: modified.content ?? skillInfo.content,
            };
          }
        } catch (hookError) {
          if (cfg.debug) {
            console.warn(`Skill hook error for ${filePath}:`, hookError);
          }
        }
      }
    }

    return { success: true, skill: skillInfo };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to load skill: ${message}`,
      filePath,
    };
  }
}

// ============================================================
// Directory Loading
// ============================================================

/**
 * Load all skills from a directory
 *
 * @param dir - Directory path
 * @param config - Loader configuration
 * @returns Array of successful skill loads
 */
export async function loadSkillsFromDirectory(
  dir: string,
  config: SkillLoaderConfig = {}
): Promise<SkillInfo[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const results: SkillInfo[] = [];

  try {
    // Check if directory exists and is readable
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) {
      return [];
    }

    // List directory contents
    const entries = await readdir(dir, { withFileTypes: true });

    // Filter valid directories to process
    const dirsToProcess = entries.filter(
      entry => entry.isDirectory() && (cfg.debug || !entry.name.startsWith('.'))
    );

    // Load all skills in parallel
    const loadPromises = dirsToProcess.map(entry => {
      const skillPath = join(dir, entry.name, cfg.skillFileName);
      return loadSkill(skillPath, config);
    });

    const loadResults = await Promise.all(loadPromises);

    for (let i = 0; i < loadResults.length; i++) {
      const result = loadResults[i];
      if (!result) continue;

      if (isSuccessfulLoadResult(result)) {
        results.push(result.skill);
      } else if (cfg.debug) {
        const entry = dirsToProcess[i];
        if (entry) {
          const skillPath = join(dir, entry.name, cfg.skillFileName);
          console.warn(`Failed to load ${skillPath}:`, result.error);
        }
      }
    }
  } catch {
    // Directory doesn't exist or not readable - return empty
    return [];
  }

  return results;
}

// ============================================================
// Skill Discovery
// ============================================================

/**
 * Discover skills across multiple search paths
 *
 * @param searchPaths - Array of directories to search
 * @param options - Discovery options
 * @param config - Loader configuration
 * @returns Array of discovered skills
 */
export async function discoverSkills(
  searchPaths: string[],
  options: SkillDiscoveryOptions = {},
  config: SkillLoaderConfig = {}
): Promise<SkillInfo[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const results: SkillInfo[] = [];
  const seenNames = new Set<string>();

  const maxDepth = options.maxDepth ?? 3;
  const recursive = options.recursive ?? true;

  async function scanDirectory(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const dirStat = await stat(dir);
      if (!dirStat.isDirectory()) return;

      const entries = await readdir(dir, { withFileTypes: true });

      // Check for SKILL.md in current directory
      for (const entry of entries) {
        if (entry.isFile() && entry.name === cfg.skillFileName) {
          const result = await loadSkill(join(dir, entry.name), config);
          if (result.success) {
            const name = result.skill.frontmatter.name;
            // Skip duplicates
            if (!seenNames.has(name)) {
              seenNames.add(name);
              results.push(result.skill);
            }
          }
          break;
        }
      }

      // Scan subdirectories in parallel
      if (recursive) {
        const subdirs = entries.filter(
          entry => entry.isDirectory() && (options.includeHidden || !entry.name.startsWith('.'))
        );

        await Promise.all(subdirs.map(entry => scanDirectory(join(dir, entry.name), depth + 1)));
      }
    } catch {
      // Skip unreadable directories
    }
  }

  await Promise.all(searchPaths.map(path => scanDirectory(path, 0)));

  // Apply filters
  let filtered = results;

  if (options.nameFilter) {
    filtered = filtered.filter(s => options.nameFilter?.test(s.frontmatter.name));
  }

  if (options.keywordFilter && options.keywordFilter.length > 0) {
    filtered = filtered.filter(s => {
      const keywords = s.frontmatter.keywords ?? [];
      return options.keywordFilter?.some(k => keywords.includes(k));
    });
  }

  return filtered;
}

// ============================================================
// Skill Registry (In-Memory)
// ============================================================

/**
 * In-memory skill registry for caching loaded skills
 */
export class SkillRegistry {
  private skills: Map<string, SkillInfo> = new Map();
  private config: Required<SkillLoaderConfig>;

  constructor(config: SkillLoaderConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get a skill by name
   */
  get(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  /**
   * Check if skill exists
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * List all skill names
   */
  list(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * Get all skills
   */
  getAll(): SkillInfo[] {
    return Array.from(this.skills.values());
  }

  /**
   * Load and register a skill from file
   */
  async load(filePath: string): Promise<SkillLoadResult> {
    const result = await loadSkill(filePath, this.config);
    if (result.success) {
      this.skills.set(result.skill.frontmatter.name, result.skill);
    }
    return result;
  }

  /**
   * Load skills from directory
   */
  async loadDirectory(dir: string): Promise<SkillInfo[]> {
    const skills = await loadSkillsFromDirectory(dir, this.config);
    for (const skill of skills) {
      this.skills.set(skill.frontmatter.name, skill);
    }
    return skills;
  }

  /**
   * Discover and load skills from multiple paths
   */
  async discover(paths: string[], options?: SkillDiscoveryOptions): Promise<SkillInfo[]> {
    const skills = await discoverSkills(paths, options, this.config);
    for (const skill of skills) {
      this.skills.set(skill.frontmatter.name, skill);
    }
    return skills;
  }

  /**
   * Manually register a skill
   */
  register(skill: SkillInfo): void {
    this.skills.set(skill.frontmatter.name, skill);
  }

  /**
   * Remove a skill by name
   */
  remove(name: string): boolean {
    return this.skills.delete(name);
  }

  /**
   * Clear all skills
   */
  clear(): void {
    this.skills.clear();
  }

  /**
   * Find skills matching keywords
   */
  findByKeywords(keywords: string[]): SkillInfo[] {
    return this.getAll().filter(skill => {
      const skillKeywords = skill.frontmatter.keywords ?? [];
      return keywords.some(k => skillKeywords.includes(k));
    });
  }

  /**
   * Find skills matching trigger phrases
   */
  findByTriggers(triggers: string[]): SkillInfo[] {
    return this.getAll().filter(skill => {
      const skillTriggers = skill.frontmatter.triggers ?? [];
      return triggers.some(t => skillTriggers.includes(t));
    });
  }
}
