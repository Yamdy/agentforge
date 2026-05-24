import * as fs from 'fs/promises';
import * as path from 'path';
import type { SkillInfo, SkillFrontmatter } from './types.js';

const SKILL_DIRS = [
  path.join(process.cwd(), '.agentforge', 'skills'),
  path.join(process.cwd(), '.agents', 'skills'),
  path.join(process.cwd(), '.claude', 'skills'),
  path.join(process.cwd(), '.opencode', 'skills'),
  path.join(process.cwd(), 'skills'),
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

        // First check: individual .md files (anthropics/skills format)
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const skillPath = path.join(dir, entry.name);
            try {
              const skill = await this.loadSkill(skillPath);
              if (skill) {
                this.skills.set(skill.name, skill);
              }
            } catch (e) {
              console.warn(`Failed to load skill from ${skillPath}:`, e);
            }
          } else if (entry.isDirectory()) {
            // Check for skill in directory: SKILL.md first, then index.md, then README.md
            const skillFiles = [
              path.join(dir, entry.name, 'SKILL.md'),
              path.join(dir, entry.name, 'skill.md'),
              path.join(dir, entry.name, 'index.md'),
              path.join(dir, entry.name, 'README.md'),
            ];

            for (const skillPath of skillFiles) {
              try {
                const exists = await fs.stat(skillPath).catch(() => null);
                if (exists?.isFile()) {
                  const skill = await this.loadSkill(skillPath);
                  if (skill) {
                    this.skills.set(skill.name, skill);
                    break;
                  }
                }
              } catch {
                continue;
              }
            }
          }
        }
      } catch {
        continue;
      }
    }
  }

  private async loadSkill(filePath: string): Promise<SkillInfo | null> {
    const content = await fs.readFile(filePath, 'utf-8');
    const { frontmatter, body } = this.parseFrontmatter(content);

    // If no frontmatter, try to extract from filename and first heading
    const fm = (frontmatter || {}) as SkillFrontmatter;
    if (!fm.name || !fm.description) {
      const fileName = path.basename(filePath, '.md');
      const extracted = this.extractFromMarkdown(body, fileName);

      // Always return with extracted name and description
      return {
        name: extracted.name,
        description: extracted.description,
        location: filePath,
        content: body,
        frontmatter: { ...fm, ...extracted },
      };
    }

    return {
      name: fm.name,
      description: fm.description,
      location: filePath,
      content: body,
      frontmatter: fm,
    };
  }

  private extractFromMarkdown(
    content: string,
    defaultName: string
  ): { name: string; description: string } {
    // Try to find first heading as name
    const firstHeadingMatch = content.match(/^#\s+(.+)$/m);
    const name = firstHeadingMatch ? firstHeadingMatch[1].trim() : defaultName;

    // Try to find first paragraph as description
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l);
    let description = '';
    for (const line of lines.slice(1)) {
      if (!line.startsWith('#') && !line.startsWith('---')) {
        description = line;
        break;
      }
    }

    return { name, description: description || name };
  }

  private parseFrontmatter(content: string): {
    frontmatter: SkillFrontmatter | null;
    body: string;
  } {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: null, body: content };
    }

    try {
      const frontmatterLines = match[1].split(/\r?\n/);
      const frontmatter: Record<string, unknown> = {};
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
        } catch {
          // Ignore parsing errors, keep as string
        }
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

  findRelevantSkills(query: string): SkillInfo[] {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const queryLower = query.toLowerCase();
    const results: SkillInfo[] = [];

    for (const skill of Array.from(this.skills.values())) {
      let score = 0;

      // Check name match
      if (skill.name.toLowerCase().includes(queryLower)) {
        score += 10;
      }

      // Check description match
      if (skill.description.toLowerCase().includes(queryLower)) {
        score += 5;
      }

      // Check triggers in frontmatter
      if (skill.frontmatter?.triggers) {
        for (const trigger of skill.frontmatter.triggers) {
          if (
            trigger.toLowerCase().includes(queryLower) ||
            queryLower.includes(trigger.toLowerCase())
          ) {
            score += 8;
            break;
          }
        }
      }

      // Check keywords in frontmatter
      if (skill.frontmatter?.keywords) {
        for (const keyword of skill.frontmatter.keywords) {
          if (
            keyword.toLowerCase().includes(queryLower) ||
            queryLower.includes(keyword.toLowerCase())
          ) {
            score += 5;
            break;
          }
        }
      }

      // Check content match (lower weight)
      if (skill.content.toLowerCase().includes(queryLower)) {
        score += 2;
      }

      if (score > 0) {
        results.push(skill);
      }
    }

    // Sort by relevance
    return results.sort((a, b) => {
      const scoreA = this.calculateScore(a, queryLower);
      const scoreB = this.calculateScore(b, queryLower);
      return scoreB - scoreA;
    });
  }

  private calculateScore(skill: SkillInfo, queryLower: string): number {
    let score = 0;
    if (skill.name.toLowerCase().includes(queryLower)) score += 10;
    if (skill.description.toLowerCase().includes(queryLower)) score += 5;
    if (skill.frontmatter?.triggers) {
      if (skill.frontmatter.triggers.some((t: string) => t.toLowerCase().includes(queryLower))) {
        score += 8;
      }
    }
    if (skill.frontmatter?.keywords) {
      if (skill.frontmatter.keywords.some((k: string) => k.toLowerCase().includes(queryLower))) {
        score += 5;
      }
    }
    return score;
  }

  async refresh(): Promise<void> {
    await this.discover();
  }
}

export const discovery = new SkillDiscovery();
