/**
 * Unit tests for src/skill module
 *
 * Tests skill loading, parsing, and registry functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, stat } from 'fs/promises';
import { join, resolve } from 'path';
import {
  SkillFrontmatterSchema,
  type SkillFrontmatter,
  type SkillInfo,
  isSkillFrontmatter,
  parseSkillFile,
  extractSections,
  extractTitle,
  validateSkillName,
  checkCompatibility,
  loadSkill,
  loadSkillsFromDirectory,
  discoverSkills,
  SkillRegistry,
  SkillHookManager,
  createLoggingHook,
  createValidationHook,
} from '../../src/skill/index.js';
import type { SkillLoadResult } from '../../src/skill/types.js';

// ============================================================
// Test Fixtures
// ============================================================

const TEST_DIR = join(process.cwd(), 'tests-temp-skill');

const VALID_SKILL_CONTENT = `---
name: git-release
description: Create consistent git releases with changelogs
version: "1.0"
author: agentforge-team
license: MIT
allowedTools:
  - bash
  - read
  - write
triggers:
  - release
  - changelog
keywords:
  - git
  - version
  - semver
---

# Git Release Skill

## Workflow

When creating a new version release:

1. **Validate version number**
   - Use \`read\` tool to check package.json

2. **Generate changelog**
   - Use \`bash\` tool to run git log

## Notes

- Follow Conventional Commits
- Ensure tests pass
`;

const MINIMAL_SKILL_CONTENT = `---
name: minimal-skill
description: A minimal skill
---

# Minimal

Just a simple skill.
`;

const EMPTY_CONTENT_SKILL = `---
name: empty-skill
description: Empty content skill
---
`;

const TRIM_TEST_SKILL = `---
name: test-skill
description: Trim test
---

# Title

`;

const INVALID_SKILL_NO_FRONTMATTER = `# Skill Without Frontmatter

This skill has no frontmatter.`;

const INVALID_SKILL_INVALID_YAML = `---
name: invalid skill name
description: Test
---
# Test`;

const INVALID_SKILL_MISSING_REQUIRED = `---
description: Missing name field
---
# Test`;

// ============================================================
// SkillFrontmatterSchema Tests
// ============================================================

describe('SkillFrontmatterSchema', () => {
  it('should validate complete frontmatter', () => {
    const data = {
      name: 'test-skill',
      description: 'A test skill for validation',
      version: '1.0.0',
      author: 'test-author',
      license: 'MIT',
      allowedTools: ['bash', 'read'],
      triggers: ['test'],
      keywords: ['test', 'skill'],
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should validate minimal frontmatter (name + description only)', () => {
    const data = {
      name: 'minimal',
      description: 'Minimal skill',
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject missing name', () => {
    const data = {
      description: 'No name',
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should reject missing description', () => {
    const data = {
      name: 'no-description',
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should reject name longer than 64 characters', () => {
    const data = {
      name: 'a'.repeat(65),
      description: 'Too long name',
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should reject description longer than 1024 characters', () => {
    const data = {
      name: 'test',
      description: 'a'.repeat(1025),
    };

    const result = SkillFrontmatterSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

// ============================================================
// isSkillFrontmatter Type Guard Tests
// ============================================================

describe('isSkillFrontmatter', () => {
  it('should return true for valid frontmatter', () => {
    const data = {
      name: 'skill',
      description: 'A skill',
    };

    expect(isSkillFrontmatter(data)).toBe(true);
  });

  it('should return false for invalid frontmatter', () => {
    const data = {
      name: 123,
    };

    expect(isSkillFrontmatter(data)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isSkillFrontmatter(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isSkillFrontmatter(undefined)).toBe(false);
  });
});

// ============================================================
// parseSkillFile Tests
// ============================================================

describe('parseSkillFile', () => {
  it('should parse valid skill file', () => {
    const result = parseSkillFile(VALID_SKILL_CONTENT);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.frontmatter.name).toBe('git-release');
      expect(result.data.frontmatter.description).toBe(
        'Create consistent git releases with changelogs'
      );
      expect(result.data.frontmatter.version).toBe('1.0');
      expect(result.data.frontmatter.allowedTools).toEqual(['bash', 'read', 'write']);
      expect(result.data.content).toContain('# Git Release Skill');
    }
  });

  it('should parse minimal skill file', () => {
    const result = parseSkillFile(MINIMAL_SKILL_CONTENT);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.frontmatter.name).toBe('minimal-skill');
      expect(result.data.frontmatter.description).toBe('A minimal skill');
      expect(result.data.frontmatter.version).toBeUndefined();
    }
  });

  it('should reject file without frontmatter', () => {
    const result = parseSkillFile(INVALID_SKILL_NO_FRONTMATTER);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('must start with YAML frontmatter');
    }
  });

  it('should reject invalid frontmatter (missing required)', () => {
    const result = parseSkillFile(INVALID_SKILL_MISSING_REQUIRED);

    expect(result.success).toBe(false);
  });

  it('should handle empty content', () => {
    const result = parseSkillFile(EMPTY_CONTENT_SKILL);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('');
    }
  });

  it('should trim content whitespace', () => {
    const result = parseSkillFile(TRIM_TEST_SKILL);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('# Title');
    }
  });
});

// ============================================================
// extractSections Tests
// ============================================================

describe('extractSections', () => {
  it('should extract sections from markdown', () => {
    const content = `# Title

## Section 1

Content for section 1.

## Section 2

Content for section 2.
`;

    const sections = extractSections(content);

    expect(sections.size).toBe(2);
    expect(sections.get('Section 1')).toBe('Content for section 1.');
    expect(sections.get('Section 2')).toBe('Content for section 2.');
  });

  it('should return empty map for content without sections', () => {
    const sections = extractSections('Just some text without headings.');
    expect(sections.size).toBe(0);
  });
});

// ============================================================
// extractTitle Tests
// ============================================================

describe('extractTitle', () => {
  it('should extract title from first heading', () => {
    const title = extractTitle('# My Skill Title\n\nSome content');
    expect(title).toBe('My Skill Title');
  });

  it('should return null if no title', () => {
    const title = extractTitle('No heading here');
    expect(title).toBeNull();
  });
});

// ============================================================
// validateSkillName Tests
// ============================================================

describe('validateSkillName', () => {
  it('should accept valid names', () => {
    expect(validateSkillName('skill')).toBe(true);
    expect(validateSkillName('my-skill')).toBe(true);
    expect(validateSkillName('skill_123')).toBe(true);
  });

  it('should reject invalid names', () => {
    expect(validateSkillName('')).toBe(false);
    expect(validateSkillName('1skill')).toBe(false);
    expect(validateSkillName('Skill')).toBe(false);
    expect(validateSkillName('skill!')).toBe(false);
    expect(validateSkillName('a'.repeat(65))).toBe(false);
  });
});

// ============================================================
// checkCompatibility Tests
// ============================================================

describe('checkCompatibility', () => {
  it('should return true for undefined compatibility', () => {
    expect(checkCompatibility(undefined, '1.0.0')).toBe(true);
  });

  it('should return true for compatible version', () => {
    expect(checkCompatibility('agentforge >=0.5.0', '1.0.0')).toBe(true);
    expect(checkCompatibility('agentforge >=0.1.0', '0.1.0')).toBe(true);
  });

  it('should return false for incompatible version', () => {
    expect(checkCompatibility('agentforge >=2.0.0', '1.0.0')).toBe(false);
    expect(checkCompatibility('agentforge >=0.5.0', '0.1.0')).toBe(false);
  });

  it('should return true for malformed compatibility string', () => {
    expect(checkCompatibility('invalid', '1.0.0')).toBe(true);
  });
});

// ============================================================
// File System Tests (loadSkill, loadSkillsFromDirectory)
// ============================================================

describe('File System Operations', () => {
  beforeEach(async () => {
    // Create test directory structure
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test directory
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('loadSkill', () => {
    it('should load a valid skill file', async () => {
      const skillPath = join(TEST_DIR, 'SKILL.md');
      await writeFile(skillPath, VALID_SKILL_CONTENT);

      const result = await loadSkill(skillPath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.skill.frontmatter.name).toBe('git-release');
        expect(result.skill.location).toBe(resolve(skillPath));
        expect(result.skill.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('should return error for non-existent file', async () => {
      const result = await loadSkill(join(TEST_DIR, 'non-existent', 'SKILL.md'));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Failed to load');
      }
    });

    it('should return error for invalid skill file', async () => {
      const skillPath = join(TEST_DIR, 'SKILL.md');
      await writeFile(skillPath, INVALID_SKILL_NO_FRONTMATTER);

      const result = await loadSkill(skillPath);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('must start with YAML frontmatter');
      }
    });
  });

  describe('loadSkillsFromDirectory', () => {
    it('should load skills from subdirectories', async () => {
      // Create skill directories
      const skill1Dir = join(TEST_DIR, 'skill1');
      const skill2Dir = join(TEST_DIR, 'skill2');

      await mkdir(skill1Dir, { recursive: true });
      await mkdir(skill2Dir, { recursive: true });

      await writeFile(join(skill1Dir, 'SKILL.md'), VALID_SKILL_CONTENT);
      await writeFile(join(skill2Dir, 'SKILL.md'), MINIMAL_SKILL_CONTENT);

      const skills = await loadSkillsFromDirectory(TEST_DIR);

      expect(skills.length).toBe(2);
      expect(skills.map((s) => s.frontmatter.name)).toContain('git-release');
      expect(skills.map((s) => s.frontmatter.name)).toContain('minimal-skill');
    });

    it('should return empty array for non-existent directory', async () => {
      const skills = await loadSkillsFromDirectory('/non/existent/directory');
      expect(skills).toEqual([]);
    });

    it('should skip files (only directories)', async () => {
      // Create a file in the directory
      await writeFile(join(TEST_DIR, 'some-file.txt'), 'Not a skill');

      const skills = await loadSkillsFromDirectory(TEST_DIR);
      expect(skills).toEqual([]);
    });

    it('should skip hidden directories by default', async () => {
      const hiddenDir = join(TEST_DIR, '.hidden-skill');
      await mkdir(hiddenDir, { recursive: true });
      await writeFile(join(hiddenDir, 'SKILL.md'), MINIMAL_SKILL_CONTENT);

      const skills = await loadSkillsFromDirectory(TEST_DIR);
      expect(skills.length).toBe(0);
    });
  });

  describe('discoverSkills', () => {
    it('should discover skills from multiple paths', async () => {
      const path1 = join(TEST_DIR, 'skills1');
      const path2 = join(TEST_DIR, 'skills2');

      await mkdir(join(path1, 'skill-a'), { recursive: true });
      await mkdir(join(path2, 'skill-b'), { recursive: true });

      await writeFile(join(path1, 'skill-a', 'SKILL.md'), MINIMAL_SKILL_CONTENT);

      const differentSkill = `---
name: different-skill
description: Different
---
# Different`;
      await writeFile(join(path2, 'skill-b', 'SKILL.md'), differentSkill);

      const skills = await discoverSkills([path1, path2]);

      expect(skills.length).toBe(2);
    });

    it('should respect maxDepth option', async () => {
      const deepDir = join(TEST_DIR, 'level1', 'level2', 'level3', 'level4');
      await mkdir(join(deepDir, 'skill'), { recursive: true });
      await writeFile(join(deepDir, 'skill', 'SKILL.md'), MINIMAL_SKILL_CONTENT);

      // With maxDepth=3, should not find skill at level 4
      const skills = await discoverSkills([TEST_DIR], { maxDepth: 3 });
      expect(skills.length).toBe(0);
    });

    it('should filter by name pattern', async () => {
      const skillDir = join(TEST_DIR, 'my-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), MINIMAL_SKILL_CONTENT);

      const skills = await discoverSkills([TEST_DIR], {
        nameFilter: /^minimal-/,
      });

      expect(skills.length).toBe(1);
      expect(skills[0]?.frontmatter.name).toBe('minimal-skill');
    });
  });
});

// ============================================================
// SkillRegistry Tests
// ============================================================

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it('should register and retrieve skills', () => {
    const skill: SkillInfo = {
      frontmatter: {
        name: 'test-skill',
        description: 'Test',
      },
      content: '# Test',
      location: '/test/SKILL.md',
      updatedAt: new Date(),
    };

    registry.register(skill);

    expect(registry.has('test-skill')).toBe(true);
    expect(registry.get('test-skill')).toBe(skill);
  });

  it('should list all registered skills', () => {
    registry.register({
      frontmatter: { name: 'skill1', description: 'Test' },
      content: '',
      location: '/1/SKILL.md',
      updatedAt: new Date(),
    });

    registry.register({
      frontmatter: { name: 'skill2', description: 'Test' },
      content: '',
      location: '/2/SKILL.md',
      updatedAt: new Date(),
    });

    expect(registry.list()).toEqual(['skill1', 'skill2']);
    expect(registry.getAll().length).toBe(2);
  });

  it('should remove skills', () => {
    registry.register({
      frontmatter: { name: 'test', description: 'Test' },
      content: '',
      location: '/test/SKILL.md',
      updatedAt: new Date(),
    });

    expect(registry.remove('test')).toBe(true);
    expect(registry.has('test')).toBe(false);
    expect(registry.remove('nonexistent')).toBe(false);
  });

  it('should clear all skills', () => {
    registry.register({
      frontmatter: { name: 'test', description: 'Test' },
      content: '',
      location: '/test/SKILL.md',
      updatedAt: new Date(),
    });

    registry.clear();
    expect(registry.list().length).toBe(0);
  });

  it('should find by keywords', () => {
    registry.register({
      frontmatter: {
        name: 'git-skill',
        description: 'Git operations',
        keywords: ['git', 'version-control'],
      },
      content: '',
      location: '/git/SKILL.md',
      updatedAt: new Date(),
    });

    registry.register({
      frontmatter: {
        name: 'npm-skill',
        description: 'NPM operations',
        keywords: ['npm', 'package'],
      },
      content: '',
      location: '/npm/SKILL.md',
      updatedAt: new Date(),
    });

    const results = registry.findByKeywords(['git']);
    expect(results.length).toBe(1);
    expect(results[0]?.frontmatter.name).toBe('git-skill');
  });

  it('should find by triggers', () => {
    registry.register({
      frontmatter: {
        name: 'release-skill',
        description: 'Release helper',
        triggers: ['release', 'publish'],
      },
      content: '',
      location: '/release/SKILL.md',
      updatedAt: new Date(),
    });

    const results = registry.findByTriggers(['release']);
    expect(results.length).toBe(1);
  });
});

// ============================================================
// SkillHookManager Tests
// ============================================================

describe('SkillHookManager', () => {
  let hookManager: SkillHookManager;

  beforeEach(() => {
    hookManager = new SkillHookManager();
  });

  it('should register hooks in priority order', () => {
    const executionOrder: string[] = [];

    hookManager.register({ name: 'low', priority: 1, afterLoad: () => { executionOrder.push('low'); } });
    hookManager.register({ name: 'high', priority: 10, afterLoad: () => { executionOrder.push('high'); } });
    hookManager.register({ name: 'medium', priority: 5, afterLoad: () => { executionOrder.push('medium'); } });

    expect(hookManager.getHooks()[0]?.name).toBe('high');
    expect(hookManager.getHooks()[1]?.name).toBe('medium');
    expect(hookManager.getHooks()[2]?.name).toBe('low');
  });

  it('should unregister hooks by name', () => {
    hookManager.register({ name: 'test' });
    expect(hookManager.unregister('test')).toBe(true);
    expect(hookManager.getHooks().length).toBe(0);
    expect(hookManager.unregister('nonexistent')).toBe(false);
  });

  it('should execute beforeLoad hooks', async () => {
    let called = false;

    hookManager.register({
      beforeLoad: () => {
        called = true;
        return true;
      },
    });

    const result = await hookManager.executeBeforeLoad({
      filePath: '/test/SKILL.md',
    });

    expect(result).toBe(true);
    expect(called).toBe(true);
  });

  it('should stop beforeLoad on false return', async () => {
    const order: string[] = [];

    hookManager.register({
      name: 'first',
      priority: 10,
      beforeLoad: () => {
        order.push('first');
        return false;
      },
    });

    hookManager.register({
      name: 'second',
      priority: 5,
      beforeLoad: () => {
        order.push('second');
        return true;
      },
    });

    const result = await hookManager.executeBeforeLoad({
      filePath: '/test/SKILL.md',
    });

    expect(result).toBe(false);
    expect(order).toEqual(['first']); // Second hook not called
  });

  it('should execute afterLoad hooks', async () => {
    hookManager.register({
      afterLoad: () => ({
        content: 'Modified content',
      }),
    });

    const skill: SkillInfo = {
      frontmatter: { name: 'test', description: 'Test' },
      content: 'Original',
      location: '/test/SKILL.md',
      updatedAt: new Date(),
    };

    const result = await hookManager.executeAfterLoad(skill);
    expect(result.content).toBe('Modified content');
  });

  it('should handle hook errors gracefully', async () => {
    hookManager.register({
      beforeLoad: () => {
        throw new Error('Hook error');
      },
    });

    // Should not throw, should return true (continue)
    const result = await hookManager.executeBeforeLoad({
      filePath: '/test/SKILL.md',
    });

    expect(result).toBe(true);
  });
});

// ============================================================
// Built-in Hooks Tests
// ============================================================

describe('Built-in Hooks', () => {
  describe('createValidationHook', () => {
    it('should validate minimum description length', () => {
      const hook = createValidationHook({ minDescriptionLength: 20 });

      const skill: SkillInfo = {
        frontmatter: {
          name: 'test',
          description: 'Too short', // Only 8 characters
        },
        content: '',
        location: '/test/SKILL.md',
        updatedAt: new Date(),
      };

      expect(() => hook.afterLoad?.(skill)).toThrow('Description too short');
    });

    it('should pass valid skills', () => {
      const hook = createValidationHook({ minDescriptionLength: 10 });

      const skill: SkillInfo = {
        frontmatter: {
          name: 'test',
          description: 'Long enough description',
        },
        content: '',
        location: '/test/SKILL.md',
        updatedAt: new Date(),
      };

      // Should not throw
      expect(() => hook.afterLoad?.(skill)).not.toThrow();
    });
  });

  describe('createLoggingHook', () => {
    it('should create a logging hook', () => {
      const hook = createLoggingHook();
      expect(hook.name).toBe('logging');
      expect(hook.beforeLoad).toBeDefined();
      expect(hook.afterLoad).toBeDefined();
      expect(hook.onError).toBeDefined();
      expect(hook.onDiscovered).toBeDefined();
    });
  });
});
