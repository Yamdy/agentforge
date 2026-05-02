/**
 * AgentForge SKILL.md Parser
 *
 * Parses SKILL.md files with YAML frontmatter and Markdown content.
 *
 * Format:
 * ```markdown
 * ---
 * name: skill-name
 * description: Skill description
 * version: "1.0"
 * ---
 *
 * # Skill Instructions
 * ...
 * ```
 *
 */

import type { SkillFrontmatter } from './types.js';
import { SkillFrontmatterSchema } from './types.js';

// ============================================================
// Parsed Skill File
// ============================================================

/**
 * Result of parsing a SKILL.md file
 */
export interface ParsedSkillFile {
  /** Parsed frontmatter (validated) */
  frontmatter: SkillFrontmatter;
  /** Raw frontmatter string */
  rawFrontmatter: string;
  /** Markdown content after frontmatter */
  content: string;
}

// ============================================================
// Parse Error
// ============================================================

/**
 * Error during parsing
 */
export interface ParseError {
  message: string;
  line?: number;
  column?: number;
}

// ============================================================
// Parse Result
// ============================================================

/**
 * Result of parse operation (never throws)
 */
export type ParseResult<T> = { success: true; data: T } | { success: false; error: ParseError };

// ============================================================
// YAML Frontmatter Parser
// ============================================================

/**
 * Parse YAML frontmatter into a key-value object
 *
 * Supports:
 * - Simple key: value pairs
 * - Multi-line strings (basic)
 * - Arrays (dash-prefixed lines)
 * - Quoted strings
 */
function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');

  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Skip empty lines
    if (line.trim() === '') {
      continue;
    }

    // Check for array item
    if (line.trim().startsWith('- ')) {
      if (currentArray !== null && currentKey !== null) {
        const value = line.trim().slice(2).trim();
        // Remove quotes if present
        const unquoted = value.replace(/^["']|["']$/g, '');
        currentArray.push(unquoted);
      }
      continue;
    }

    // Check for key-value pair
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      // Save previous array if exists
      if (currentArray !== null && currentKey !== null) {
        result[currentKey] = currentArray;
        currentArray = null;
      }

      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();

      // Check if this starts an array
      if (value === '') {
        // Check next line for array indicator
        const nextLine = lines[i + 1];
        if (nextLine !== undefined && nextLine.trim().startsWith('- ')) {
          currentKey = key;
          currentArray = [];
          continue;
        }
        // Empty value
        result[key] = '';
        currentKey = null;
        continue;
      }

      // Check if value was quoted (to preserve type)
      const wasQuoted = /^["']/.test(value);

      // Remove quotes if present
      value = value.replace(/^["']|["']$/g, '');

      // Convert to appropriate type (but keep quoted values as strings)
      if (wasQuoted) {
        // Quoted values are always strings
        result[key] = value;
      } else if (value === 'true') {
        result[key] = true;
      } else if (value === 'false') {
        result[key] = false;
      } else if (value === 'null') {
        result[key] = null;
      } else if (/^\d+$/.test(value)) {
        result[key] = parseInt(value, 10);
      } else if (/^\d+\.\d+$/.test(value)) {
        result[key] = parseFloat(value);
      } else {
        result[key] = value;
      }

      currentKey = key;
      currentArray = null;
    }
  }

  // Save last array if exists
  if (currentArray !== null && currentKey !== null) {
    result[currentKey] = currentArray;
  }

  return result;
}

// ============================================================
// SKILL.md Parser
// ============================================================

/**
 * Parse a SKILL.md file content
 *
 * @param content - Raw file content
 * @returns Parse result with frontmatter and content
 */
export function parseSkillFile(content: string): ParseResult<ParsedSkillFile> {
  // Check for frontmatter markers
  if (!content.startsWith('---')) {
    return {
      success: false,
      error: {
        message: 'SKILL.md must start with YAML frontmatter (---)',
        line: 1,
      },
    };
  }

  // Find the first newline after the opening ---
  const firstNewlineIndex = content.indexOf('\n');
  if (firstNewlineIndex === -1 || firstNewlineIndex < 3) {
    return {
      success: false,
      error: {
        message: 'Invalid frontmatter: missing newline after opening ---',
        line: 1,
      },
    };
  }

  // Find end of frontmatter (--- on its own line)
  // Look for \n---\n or \n--- at end of content
  let endMarkerIndex = -1;
  let contentStartIndex = -1;

  // Search for closing --- marker
  const searchStart = firstNewlineIndex + 1;
  const patterns = ['\n---\n', '\n---\r\n', '\n---'];

  for (const pattern of patterns) {
    const idx = content.indexOf(pattern, searchStart);
    if (idx !== -1) {
      if (endMarkerIndex === -1 || idx < endMarkerIndex) {
        endMarkerIndex = idx;
        contentStartIndex = idx + pattern.length;
      }
    }
  }

  if (endMarkerIndex === -1) {
    return {
      success: false,
      error: {
        message: 'YAML frontmatter must end with ---',
        line: 1,
      },
    };
  }

  // Extract frontmatter and content
  const rawFrontmatter = content.slice(firstNewlineIndex + 1, endMarkerIndex).trim();
  const markdownContent = content.slice(contentStartIndex).trim();

  // Parse YAML
  const frontmatterData = parseYamlFrontmatter(rawFrontmatter);

  // Validate against schema
  const parseResult = SkillFrontmatterSchema.safeParse(frontmatterData);
  if (!parseResult.success) {
    const firstError = parseResult.error.errors[0];
    const errorMessage = `Invalid frontmatter: ${firstError?.message ?? 'Unknown error'}`;
    const errorLine = firstError?.path[0]
      ? findLineWithKey(rawFrontmatter, String(firstError.path[0]))
      : undefined;

    const error: ParseError = { message: errorMessage };
    if (errorLine !== undefined) {
      error.line = errorLine;
    }

    return {
      success: false,
      error,
    };
  }

  return {
    success: true,
    data: {
      frontmatter: parseResult.data,
      rawFrontmatter,
      content: markdownContent,
    },
  };
}

/**
 * Find line number containing a key
 */
function findLineWithKey(yaml: string, key: string): number {
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.startsWith(key + ':')) {
      return i + 1;
    }
  }
  return 1;
}

// ============================================================
// Content Extraction Helpers
// ============================================================

/**
 * Extract sections from markdown content
 *
 * @param content - Markdown content
 * @returns Map of section title to content
 */
export function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');

  let currentSection = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    // Check for heading (## and above, excluding # which is typically the title)
    const headingMatch = line.match(/^(#{2,6})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentSection !== '') {
        sections.set(currentSection, currentContent.join('\n').trim());
      }
      currentSection = headingMatch[2] ?? '';
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection !== '') {
    sections.set(currentSection, currentContent.join('\n').trim());
  }

  return sections;
}

/**
 * Extract title from markdown content (first # heading)
 *
 * @param content - Markdown content
 * @returns Title or null if not found
 */
export function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1] ?? null;
}

// ============================================================
// Validation Helpers
// ============================================================

/**
 * Validate skill name format
 *
 * Rules:
 * - Lowercase letters, numbers, hyphens, underscores
 * - Must start with letter
 * - 1-64 characters
 */
export function validateSkillName(name: string): boolean {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(name);
}

/**
 * Check if skill is compatible with current version
 *
 * @param compatibility - Compatibility string (e.g., "agentforge >=0.1.0")
 * @param currentVersion - Current AgentForge version
 */
export function checkCompatibility(
  compatibility: string | undefined,
  currentVersion: string
): boolean {
  if (!compatibility) return true;

  // Simple version check: supports "agentforge >=X.Y.Z" format
  const match = compatibility.match(/agentforge\s*>=?\s*(\d+\.\d+\.\d+)/);
  if (!match?.[1]) return true;

  const required = match[1].split('.').map(Number);
  const current = currentVersion.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const req = required[i] ?? 0;
    const cur = current[i] ?? 0;
    if (cur > req) return true;
    if (cur < req) return false;
  }

  return true;
}
