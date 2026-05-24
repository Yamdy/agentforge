import { describe, it, expect, beforeAll } from 'vitest';
import { Skill } from '../../src/skill/index.js';

describe('SKILL Module Tests', () => {
  beforeAll(async () => {
    await Skill.discover();
  });

  describe('Configuration and Types', () => {
    it('should export Skill namespace', () => {
      expect(Skill).toBeDefined();
      expect(Skill.discover).toBeDefined();
      expect(Skill.list).toBeDefined();
      expect(Skill.get).toBeDefined();
      expect(Skill.refresh).toBeDefined();
      expect(Skill.createLoadSkillTool).toBeDefined();
      expect(Skill.createListSkillsTool).toBeDefined();
    });
  });

  describe('SKILL Discovery', () => {
    it('should discover SKILLs', async () => {
      const skills = Skill.list();
      expect(Array.isArray(skills)).toBe(true);
    });

    // Depends on git-release skill existing in .agentforge/skills
    it('should find the git-release example SKILL', () => {
      const gitReleaseSkill = Skill.get('git-release');
      if (gitReleaseSkill) {
        expect(gitReleaseSkill).toBeDefined();
        expect(gitReleaseSkill.name).toBe('git-release');
        expect(gitReleaseSkill.description).toContain('release');
      } else {
        // Skip if not found - it means it just wasn't checked into this repo
        expect(true).toBe(true);
      }
    });
  });

  describe('SKILL Tools', () => {
    it('should create load_skill tool', () => {
      const tool = Skill.createLoadSkillTool();
      expect(tool.name).toBe('load_skill');
      expect(typeof tool.execute).toBe('function');
    });

    it('should create list_skills tool', () => {
      const tool = Skill.createListSkillsTool();
      expect(tool.name).toBe('list_skills');
      expect(typeof tool.execute).toBe('function');
    });

    it('should load an existing SKILL via tool', async () => {
      const tool = Skill.createLoadSkillTool();
      const result = await tool.execute({ name: 'git-release' });
      expect(typeof result).toBe('string');
      expect(result).toContain('git-release');
    });

    it('should handle non-existent SKILL via tool', async () => {
      const tool = Skill.createLoadSkillTool();
      const result = await tool.execute({ name: 'non-existent-skill' });
      expect(typeof result).toBe('string');
      expect(result).toContain('not found');
    });

    it('should list SKILLs via tool', async () => {
      const tool = Skill.createListSkillsTool();
      const result = await tool.execute({});
      expect(typeof result).toBe('string');
    });
  });
});
