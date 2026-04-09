import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SkillInfo, SkillFrontmatter } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILL_DIRS = [
  path.join(process.cwd(), '.agentforge', 'skills'),
  path.join(process.cwd(), '.agents', 'skills'),
  path.join(process.cwd(), '.claude', 'skills'),
  path.join(process.cwd(), '.opencode', 'skills'),
];

class SkillDiscovery {
  private skills: Map<string, SkillInfo> = new Map();

  async discover(): Promise<void> {
    this.skills.clear();

    for (const dir of SKILL_DIRS) {
      try {
        const exists = await fs.stat(dir).catch(() => null);
        if (!exists?.isDirectory()) continue;

        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillPath = path.join(dir, entry.name, 'SKILL.md');
            try {
              const skill = await this.loadSkill(skillPath);
              if (skill) {
                this.skills.set(skill.name, skill);
              }
            } catch (e) {
              console.warn(`Failed to load skill from ${skillPath}:`, e);
            }
          }
        }
      } catch (e) {
        continue;
      }
    }
  }

  private async loadSkill(filePath: string): Promise<SkillInfo | null> {
    const content = await fs.readFile(filePath, 'utf-8');
    const { frontmatter, body } = this.parseFrontmatter(content);

    if (!frontmatter?.name || !frontmatter?.description) {
      return null;
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      location: filePath,
      content: body,
      frontmatter,
    };
  }

  private parseFrontmatter(content: string): {
    frontmatter: SkillFrontmatter | null;
    body: string;
  } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: null, body: content };
    }

    try {
      const frontmatterLines = match[1].split('\n');
      const frontmatter: Record<string, any> = {};
      let currentKey: string | null = null;
      let currentValue: string[] = [];

      for (const line of frontmatterLines) {
        const keyValueMatch = line.match(/^(\w+):\s*(.*)$/);
        if (keyValueMatch) {
          if (currentKey) {
            frontmatter[currentKey] = currentValue.join('\n').trim() || true;
          }
          currentKey = keyValueMatch[1];
          currentValue = [keyValueMatch[2]];
        } else if (currentKey && line.startsWith('  ')) {
          currentValue.push(line.slice(2));
        }
      }

      if (currentKey) {
        const value = currentValue.join('\n').trim();
        frontmatter[currentKey] = value || true;
      }

      if (frontmatter.metadata && typeof frontmatter.metadata === 'string') {
        try {
          frontmatter.metadata = JSON.parse(frontmatter.metadata);
        } catch {}
      }

      return {
        frontmatter: frontmatter as SkillFrontmatter,
        body: match[2].trim(),
      };
    } catch {
      return { frontmatter: null, body: content };
    }
  }

  list(): SkillInfo[] {
    return Array.from(this.skills.values());
  }

  get(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  async refresh(): Promise<void> {
    await this.discover();
  }
}

export const discovery = new SkillDiscovery();
