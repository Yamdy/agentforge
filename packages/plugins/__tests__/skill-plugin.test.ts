import { describe, it, expect } from 'vitest';
import { skillPlugin, parseFrontmatter, discoverSkills, type SkillDefinition } from '../src/skill/index.js';
import type { HarnessAPI, PipelineContext } from '@agentforge/sdk';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** In-memory file system for testing skill discovery without disk I/O */
interface MockFileSystem {
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
}

function createMockFileSystem(files: Map<string, string>): MockFileSystem {
  return {
    async readdir(path: string): Promise<string[]> {
      const normalizedPath = path.replace(/\\/g, '/');
      const entries = new Set<string>();
      for (const filePath of files.keys()) {
        const normalizedFilePath = filePath.replace(/\\/g, '/');
        if (normalizedFilePath.startsWith(normalizedPath + '/')) {
          const relative = normalizedFilePath.slice(normalizedPath.length + 1);
          const firstSegment = relative.split('/')[0];
          entries.add(firstSegment);
        }
      }
      return [...entries];
    },
    async readFile(path: string): Promise<string> {
      const normalizedPath = path.replace(/\\/g, '/');
      const content = files.get(normalizedPath);
      if (content === undefined) throw new Error(`File not found: ${normalizedPath}`);
      return content;
    },
  };
}

function createHarnessAPI(): { api: HarnessAPI; processors: Map<string, unknown>; tools: Map<string, unknown> } {
  const processors = new Map<string, unknown>();
  const tools = new Map<string, unknown>();

  const api: HarnessAPI = {
    registerProcessor: (stage, processor) => { processors.set(stage, processor); },
    registerTool: (tool) => { tools.set(tool.name, tool); },
    registerCommand: () => {},
    registerHook: () => {},
    subscribe: () => () => {},
    registerResource: () => {},
    registerProvider: () => {},
  };

  return { api, processors, tools };
}

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    iteration: { step: 0 },
    pipeline: {},
    session: {},
    config: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// YAML Frontmatter Parsing
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('parses name and description from valid YAML frontmatter', () => {
    const content = `---
name: my-skill
description: A test skill for doing things
---
# My Skill

This is the full skill content.
It has multiple lines.`;

    const result = parseFrontmatter(content);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('A test skill for doing things');
    expect(result.body).toContain('# My Skill');
    expect(result.body).toContain('It has multiple lines.');
  });

  it('returns empty strings when frontmatter is missing', () => {
    const content = `# Just a markdown file\nNo frontmatter here.`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe('');
    expect(result.description).toBe('');
    expect(result.body).toBe(content);
  });

  it('handles frontmatter with only name', () => {
    const content = `---
name: partial-skill
---
Some content.`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe('partial-skill');
    expect(result.description).toBe('');
    expect(result.body).toContain('Some content.');
  });

  it('strips frontmatter delimiters from body', () => {
    const content = `---
name: clean-skill
description: Clean body test
---
Body starts here.`;
    const result = parseFrontmatter(content);
    expect(result.body).not.toContain('---');
    expect(result.body).toBe('Body starts here.');
  });
});

// ---------------------------------------------------------------------------
// Skill Discovery
// ---------------------------------------------------------------------------

describe('discoverSkills', () => {
  it('discovers skills from a single directory', async () => {
    const fs = createMockFileSystem(new Map([
      ['/skills/debug/SKILL.md', '---\nname: debug\ndescription: Debugging tools\n---\nDebug instructions here.'],
    ]));

    const skills = await discoverSkills(['/skills'], { readdir: fs.readdir, readFile: fs.readFile });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('debug');
    expect(skills[0].description).toBe('Debugging tools');
    expect(skills[0].content).toContain('Debug instructions here.');
  });

  it('discovers multiple skills from multiple directories', async () => {
    const fs = createMockFileSystem(new Map([
      ['/global/skill-a/SKILL.md', '---\nname: skill-a\ndescription: Skill A\n---\nContent A'],
      ['/project/skill-b/SKILL.md', '---\nname: skill-b\ndescription: Skill B\n---\nContent B'],
    ]));

    const skills = await discoverSkills(['/global', '/project'], { readdir: fs.readdir, readFile: fs.readFile });
    expect(skills).toHaveLength(2);
    expect(skills.map(s => s.name)).toContain('skill-a');
    expect(skills.map(s => s.name)).toContain('skill-b');
  });

  it('later directories override earlier ones when skill names collide', async () => {
    const fs = createMockFileSystem(new Map([
      ['/global/my-skill/SKILL.md', '---\nname: my-skill\ndescription: Global version\n---\nGlobal content'],
      ['/project/my-skill/SKILL.md', '---\nname: my-skill\ndescription: Project version\n---\nProject content'],
    ]));

    const skills = await discoverSkills(['/global', '/project'], { readdir: fs.readdir, readFile: fs.readFile });
    const mySkill = skills.find(s => s.name === 'my-skill');
    expect(mySkill).toBeDefined();
    expect(mySkill!.description).toBe('Project version');
    expect(mySkill!.content).toContain('Project content');
  });

  it('skips directories with no SKILL.md files', async () => {
    const fs = createMockFileSystem(new Map([
      ['/empty/README.md', 'Not a skill file'],
    ]));

    const skills = await discoverSkills(['/empty'], { readdir: fs.readdir, readFile: fs.readFile });
    expect(skills).toHaveLength(0);
  });

  it('ignores files that are not SKILL.md in skill directories', async () => {
    const fs = createMockFileSystem(new Map([
      ['/skills/debug/SKILL.md', '---\nname: debug\ndescription: Debug\n---\nDebug content.'],
      ['/skills/debug/README.md', 'Not a skill file.'],
    ]));

    const skills = await discoverSkills(['/skills'], { readdir: fs.readdir, readFile: fs.readFile });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('debug');
  });
});

// ---------------------------------------------------------------------------
// SkillProcessor — Progressive Disclosure at buildContext
// ---------------------------------------------------------------------------

describe('SkillProcessor — buildContext', () => {
  it('injects skill summaries as promptFragments', async () => {
    const skills: SkillDefinition[] = [
      { name: 'debug', description: 'Debugging tools', content: 'Debug instructions...' },
      { name: 'review', description: 'Code review skill', content: 'Review instructions...' },
    ];

    const { api, processors } = createHarnessAPI();
    skillPlugin({ skills })(api);

    const processor = processors.get('buildContext') as { stage: string; execute: (ctx: PipelineContext) => Promise<PipelineContext> };
    expect(processor).toBeDefined();

    const ctx = makeContext();
    const result = await processor.execute(ctx);

    const fragments = result.pipeline.promptFragments as string[];
    expect(fragments).toBeDefined();
    expect(fragments.length).toBeGreaterThan(0);
    const combinedFragment = fragments.join('\n');
    expect(combinedFragment).toContain('debug');
    expect(combinedFragment).toContain('Debugging tools');
    expect(combinedFragment).toContain('review');
    expect(combinedFragment).toContain('Code review skill');
  });

  it('includes skill name and description but not full content in summary', async () => {
    const skills: SkillDefinition[] = [
      { name: 'verbose-skill', description: 'Short desc', content: 'A'.repeat(5000) },
    ];

    const { api, processors } = createHarnessAPI();
    skillPlugin({ skills })(api);

    const processor = processors.get('buildContext') as { execute: (ctx: PipelineContext) => Promise<PipelineContext> };
    const ctx = makeContext();
    const result = await processor.execute(ctx);

    const combinedFragments = (result.pipeline.promptFragments as string[]).join('\n');
    expect(combinedFragments).toContain('verbose-skill');
    expect(combinedFragments).toContain('Short desc');
    expect(combinedFragments).not.toContain('A'.repeat(100));
  });

  it('returns context unchanged when no skills are discovered', async () => {
    const { api, processors } = createHarnessAPI();
    skillPlugin({ skills: [] })(api);

    const processor = processors.get('buildContext') as { execute: (ctx: PipelineContext) => Promise<PipelineContext> };
    const ctx = makeContext();
    const result = await processor.execute(ctx);

    expect(result.pipeline.promptFragments).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// read_skill tool
// ---------------------------------------------------------------------------

describe('read_skill tool', () => {
  it('is registered when plugin is initialized', () => {
    const { api, tools } = createHarnessAPI();
    skillPlugin({ skills: [] })(api);

    expect(tools.has('read_skill')).toBe(true);
  });

  it('returns full skill content when skill is found', async () => {
    const skills: SkillDefinition[] = [
      { name: 'debug', description: 'Debug tools', content: '# Debug Skill\n\nDetailed instructions here.' },
    ];

    const { api, tools } = createHarnessAPI();
    skillPlugin({ skills })(api);

    const readSkillTool = tools.get('read_skill') as { execute: (input: { name: string }) => Promise<unknown> };
    const result = await readSkillTool.execute({ name: 'debug' });

    expect(result).toBeDefined();
    const output = result as { content: string; name: string; description: string };
    expect(output.name).toBe('debug');
    expect(output.description).toBe('Debug tools');
    expect(output.content).toContain('# Debug Skill');
    expect(output.content).toContain('Detailed instructions here.');
  });

  it('returns error message when skill is not found', async () => {
    const { api, tools } = createHarnessAPI();
    skillPlugin({ skills: [] })(api);

    const readSkillTool = tools.get('read_skill') as { execute: (input: { name: string }) => Promise<unknown> };
    const result = await readSkillTool.execute({ name: 'nonexistent' });

    const output = result as { error: string };
    expect(output.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Resource Registration
// ---------------------------------------------------------------------------

describe('Skill resources', () => {
  it('registers skill resources with HarnessAPI', () => {
    const mockServer = { connected: true };
    const skills: SkillDefinition[] = [
      {
        name: 'mcp-skill',
        description: 'Skill with MCP server',
        content: 'Skill content...',
        resources: [{
          id: 'skill-mcp-server',
          type: 'mcp-server',
          config: { command: 'npx', args: ['mcp-server'] },
          start: async () => mockServer,
          stop: async () => {},
        }],
      },
    ];

    const resources: unknown[] = [];
    const api: HarnessAPI = {
      registerProcessor: () => {},
      registerTool: () => {},
      registerCommand: () => {},
      registerHook: () => {},
      subscribe: () => () => {},
      registerResource: (decl) => { resources.push(decl); },
      registerProvider: () => {},
    };

    skillPlugin({ skills })(api);

    expect(resources).toHaveLength(1);
    const res = resources[0] as { id: string; type: string };
    expect(res.id).toBe('skill-mcp-server');
    expect(res.type).toBe('mcp-server');
  });
});

// ---------------------------------------------------------------------------
// Tool Registration from Skill Definitions
// ---------------------------------------------------------------------------

describe('Skill tools', () => {
  it('registers skill-provided tools with HarnessAPI', () => {
    const skills: SkillDefinition[] = [
      {
        name: 'tool-skill',
        description: 'Skill that provides a tool',
        content: 'Skill content...',
        tools: [{
          name: 'custom_search',
          description: 'Search for things',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          execute: async () => ({ results: [] }),
        }],
      },
    ];

    const { api, tools } = createHarnessAPI();
    skillPlugin({ skills })(api);

    expect(tools.has('custom_search')).toBe(true);
    const tool = tools.get('custom_search') as { name: string; description: string };
    expect(tool.name).toBe('custom_search');
    expect(tool.description).toBe('Search for things');
  });
});

// ---------------------------------------------------------------------------
// Full Plugin Integration
// ---------------------------------------------------------------------------

describe('skillPlugin — full integration', () => {
  it('registers buildContext processor and read_skill tool together', () => {
    const { api, processors, tools } = createHarnessAPI();
    skillPlugin({ skills: [] })(api);

    expect(processors.has('buildContext')).toBe(true);
    expect(tools.has('read_skill')).toBe(true);
  });

  it('returns PluginRegistration with processors', () => {
    const { api } = createHarnessAPI();
    const registration = skillPlugin({ skills: [] })(api);

    expect(registration.processors).toBeDefined();
    expect(registration.processors!.length).toBeGreaterThanOrEqual(1);
  });
});