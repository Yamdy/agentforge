/**
 * AgentForge Skill Type Definitions
 *
 * Skill is a static knowledge package that provides domain-specific instructions.
 * Unlike tools or subagents, skills do NOT execute code - they inject knowledge
 * into the agent's context as system prompts.
 *
 * Industry standard definition:
 * - Skill = static knowledge package (SKILL.md format)
 * - Contains frontmatter (YAML) + Markdown instructions
 * - Loaded and injected into Agent context
 *
 */

import { z } from 'zod';

// ============================================================
// Skill Frontmatter Schema
// ============================================================

/**
 * Skill frontmatter metadata (from SKILL.md YAML header)
 *
 * Validated with Zod at Tier 1 (external input).
 */
export const SkillFrontmatterSchema = z.object({
  /** Skill name (required, unique identifier) */
  name: z.string().min(1).max(64),

  /** Human-readable description */
  description: z.string().min(1).max(1024),

  /** Semantic version (optional) */
  version: z.string().optional(),

  /** Author information */
  author: z.string().optional(),

  /** License type */
  license: z.string().optional(),

  /** Allowed tools for this skill (constraint) */
  allowedTools: z.array(z.string()).optional(),

  /** Trigger phrases for auto-discovery */
  triggers: z.array(z.string()).optional(),

  /** Keywords for search/matching */
  keywords: z.array(z.string()).optional(),

  /** Compatibility marker (e.g., 'agentforge >=0.1.0') */
  compatibility: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// ============================================================
// Skill Info (Complete Skill Data)
// ============================================================

/**
 * Complete skill information after parsing
 *
 * Contains both metadata (frontmatter) and content (markdown instructions).
 */
export interface SkillInfo {
  /** Parsed frontmatter metadata */
  frontmatter: SkillFrontmatter;

  /** Markdown content (instruction part) */
  content: string;

  /** Absolute file path to SKILL.md */
  location: string;

  /** Last modification time */
  updatedAt: Date;
}

// ============================================================
// Skill Load Context
// ============================================================

/**
 * Context passed during skill loading
 *
 * Provides additional context for hooks and validation.
 */
export interface SkillLoadContext {
  /** Skill file path being loaded */
  filePath: string;

  /** Requested skill name (for validation) */
  requestedName?: string;

  /** Additional metadata for hook processing */
  metadata?: Record<string, unknown>;
}

// ============================================================
// Skill Load Result
// ============================================================

/**
 * Result of a skill loading operation
 *
 * Can be either success or failure (never throws).
 */
export type SkillLoadResult =
  | { success: true; skill: SkillInfo }
  | { success: false; error: string; filePath: string };

// ============================================================
// Skill Discovery Options
// ============================================================

/**
 * Options for skill discovery
 */
export interface SkillDiscoveryOptions {
  /** Recursive directory search */
  recursive?: boolean;

  /** Maximum directory depth (if recursive) */
  maxDepth?: number;

  /** Filter by skill name pattern */
  nameFilter?: RegExp;

  /** Filter by keywords */
  keywordFilter?: string[];

  /** Include hidden directories */
  includeHidden?: boolean;
}

// ============================================================
// Type Guards
// ============================================================

/** Check if a value is valid SkillFrontmatter */
export function isSkillFrontmatter(value: unknown): value is SkillFrontmatter {
  return SkillFrontmatterSchema.safeParse(value).success;
}

/** Check if a SkillLoadResult is successful */
export function isSuccessfulLoadResult(
  result: SkillLoadResult
): result is { success: true; skill: SkillInfo } {
  return result.success === true;
}
