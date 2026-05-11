import type { Processor, PipelineContext, ProcessorResult, HarnessAPI, PluginRegistration, ResourceDeclaration, ToolDefinition } from '@agentforge/sdk';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;                   // Full SKILL.md content
  resources?: ResourceDeclaration[];  // Skill-associated resources (e.g., MCP servers)
  tools?: ToolDefinition[];           // Skill-provided tools
}

export interface SkillFileSystem {
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
}

export interface SkillPluginOptions {
  /** Pre-discovered skills. Can be provided directly or via discoverSkills(). */
  skills?: SkillDefinition[];
  /** Skill source directories for auto-discovery. Later directories override earlier ones by skill name.
   *  Requires fileSystem or Node.js fs. */
  directories?: string[];
  /** Injectable file system for testing. Defaults to Node.js fs when directories is used. */
  fileSystem?: SkillFileSystem;
}

// ---------------------------------------------------------------------------
// YAML Frontmatter Parsing
// ---------------------------------------------------------------------------

export interface ParsedFrontmatter {
  name: string;
  description: string;
  body: string;
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Expects `---` delimiters at the start, with key: value pairs inside.
 * Returns name, description, and the body (content after the closing `---`).
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    return { name: '', description: '', body: content };
  }

  const frontmatter = match[1];
  const body = match[2];

  let name = '';
  let description = '';

  for (const line of frontmatter.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) name = nameMatch[1].trim();

    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) description = descMatch[1].trim();
  }

  return { name, description, body };
}

// ---------------------------------------------------------------------------
// Skill Discovery
// ---------------------------------------------------------------------------

/**
 * Discover skills from configured directories.
 * Scans each directory for subdirectories containing SKILL.md files.
 * Later directories override earlier ones when skill names collide.
 *
 * Call this before initializing the plugin, then pass the result to skillPlugin({ skills }).
 */
export async function discoverSkills(
  directories: string[],
  fs: SkillFileSystem,
): Promise<SkillDefinition[]> {
  const skillMap = new Map<string, SkillDefinition>();

  for (const dir of directories) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      // Directory doesn't exist or is not readable; skip
      continue;
    }

    for (const entry of entries) {
      const skillDir = `${dir}/${entry}`;
      const skillFilePath = `${skillDir}/SKILL.md`;

      try {
        const content = await fs.readFile(skillFilePath);
        const parsed = parseFrontmatter(content);

        if (!parsed.name) continue; // Skip skill files without a name

        const skill: SkillDefinition = {
          name: parsed.name,
          description: parsed.description,
          content, // Keep full content for read_skill
        };

        // Later directories override earlier ones
        skillMap.set(parsed.name, skill);
      } catch {
        // No SKILL.md in this subdirectory; skip
        continue;
      }
    }
  }

  return [...skillMap.values()];
}

// ---------------------------------------------------------------------------
// SkillProcessor — Progressive Disclosure at buildContext
// ---------------------------------------------------------------------------

/**
 * Creates a buildContext processor that injects skill summaries as PromptFragments.
 * Progressive disclosure: only name + description are included in the context,
 * not the full skill content. The agent reads full content on demand via read_skill.
 */
export function createSkillProcessor(skills: SkillDefinition[]): Processor {
  return {
    stage: 'buildContext',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      if (skills.length === 0) return ctx;

      const lines = skills.map(
        (s) => `- **${s.name}**: ${s.description}`,
      );
      const fragment = `<skills>\nAvailable skills (use read_skill tool to load full instructions):\n${lines.join('\n')}\n</skills>`;

      const existingFragments = ctx.agent.promptFragments;
      return {
        ...ctx,
        agent: {
          ...ctx.agent,
          promptFragments: [...existingFragments, fragment],
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// read_skill Tool
// ---------------------------------------------------------------------------

const ReadSkillInputSchema = z.object({
  name: z.string().describe('The name of the skill to read'),
});

/**
 * Creates the read_skill tool that loads full skill content on demand.
 */
export function createReadSkillTool(skills: SkillDefinition[]): ToolDefinition {
  const skillMap = new Map(skills.map((s) => [s.name, s]));

  return {
    name: 'read_skill',
    description: 'Load the full instructions for a skill by name. Use this when you need to apply a specific skill.',
    inputSchema: ReadSkillInputSchema,
    execute: async (input: { name: string }): Promise<unknown> => {
      const skill = skillMap.get(input.name);
      if (!skill) {
        return { error: `Skill "${input.name}" not found. Available skills: ${skills.map((s) => s.name).join(', ')}` };
      }
      return {
        name: skill.name,
        description: skill.description,
        content: skill.content,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin Factory
// ---------------------------------------------------------------------------

/**
 * SkillPlugin factory function.
 * Injects skill summaries into buildContext (progressive disclosure) and
 * provides a read_skill tool for on-demand full content loading.
 *
 * Two usage patterns:
 *
 * 1. Pre-discovered skills:
 *    const skills = await discoverSkills(['/path/to/skills'], fs);
 *    skillPlugin({ skills })
 *
 * 2. Auto-discovery (requires directories + fileSystem):
 *    skillPlugin({ directories: ['/global/skills', '/project/skills'], fileSystem: nodeFs })
 *
 * Skills can also declare resources (e.g., MCP servers) and custom tools,
 * which are registered via HarnessAPI.
 */
export function skillPlugin(options: SkillPluginOptions): (api: HarnessAPI) => PluginRegistration {
  const { skills: preDiscoveredSkills, directories, fileSystem } = options;

  return (api: HarnessAPI): PluginRegistration => {
    // Use pre-discovered skills if provided, otherwise use an empty array.
    // For auto-discovery, call discoverSkills() before initializing the plugin
    // and pass the result in `skills`.
    const skills = preDiscoveredSkills ?? [];

    // Register buildContext processor (progressive disclosure)
    const processor = createSkillProcessor(skills);
    api.registerProcessor('buildContext', processor);

    // Register read_skill tool
    const readSkillTool = createReadSkillTool(skills);
    api.registerTool(readSkillTool);

    // Register skill resources (e.g., MCP servers)
    for (const skill of skills) {
      if (skill.resources) {
        for (const resource of skill.resources) {
          api.registerResource(resource);
        }
      }
    }

    // Register skill-provided tools
    for (const skill of skills) {
      if (skill.tools) {
        for (const tool of skill.tools) {
          api.registerTool(tool);
        }
      }
    }

    return { processors: [processor] };
  };
}