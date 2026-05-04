/**
 * Skills Plugin for AgentForge
 *
 * Discovers skills on session.start and injects skill metadata
 * (progressive disclosure) before each LLM request.
 *
 * @module
 */

import type { Plugin } from '../plugins/plugin.js';
import type { Message } from '../core/events.js';
import { SkillRegistry } from '../skill/loader.js';
import { RequestHookPriority } from '../core/hooks.js';

/**
 * Skill metadata for progressive disclosure
 */
export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  license?: string | undefined;
  compatibility?: string | undefined;
  allowedTools?: string[] | undefined;
}

/**
 * Create a Skills Plugin
 *
 * Hooks:
 * - session.start: Scans skill directories, parses SKILL.md frontmatter
 * - requestHooks: Prepends skill list (name + description only) to messages
 *
 * Priority: SKILL_INSTRUCTIONS (30)
 *
 * Progressive disclosure: Only metadata is injected. Model reads full SKILL.md on demand.
 *
 * @param sources - Skill directory paths
 * @returns Plugin
 */
export function createSkillsPlugin(sources: string[]): Plugin {
  const registry = new SkillRegistry();
  let skills: SkillMetadata[] = [];

  return {
    name: 'skills',
    enabled: true,

    lifecycleHooks: [
      {
        name: 'session.start',
        fn: async () => {
          const discovered = await registry.discover(sources);
          skills = discovered.map(s => {
            const meta: SkillMetadata = {
              name: s.frontmatter.name,
              description: s.frontmatter.description,
              path: s.location,
            };
            if (s.frontmatter.license !== undefined) meta.license = s.frontmatter.license;
            if (s.frontmatter.compatibility !== undefined)
              meta.compatibility = s.frontmatter.compatibility;
            if (s.frontmatter.allowedTools !== undefined)
              meta.allowedTools = s.frontmatter.allowedTools;
            return meta;
          });
        },
      },
    ],

    requestHooks: [
      {
        name: 'skills-context',
        priority: RequestHookPriority.SKILL_INSTRUCTIONS,
        apply(messages: Message[]): Message[] {
          if (skills.length === 0) return messages;

          // Inject skill metadata (progressive disclosure)
          const skillsList = skills
            .map(s => {
              let line = `- **${s.name}**: ${s.description}`;
              if (s.license || s.compatibility) {
                const ann = [
                  s.license && `License: ${s.license}`,
                  s.compatibility && `Compatibility: ${s.compatibility}`,
                ]
                  .filter(Boolean)
                  .join(', ');
                line += ` (${ann})`;
              }
              if (s.allowedTools?.length) {
                line += `\n  -> Allowed tools: ${s.allowedTools.join(', ')}`;
              }
              line += `\n  -> Read \`${s.path}\` for full instructions`;
              return line;
            })
            .join('\n');

          const skillsMessage: Message = {
            role: 'system',
            content: `## Skills System\n\n**Available Skills:**\n\n${skillsList}`,
            name: 'skills',
          };

          return [skillsMessage, ...messages];
        },
      },
    ],
  };
}
