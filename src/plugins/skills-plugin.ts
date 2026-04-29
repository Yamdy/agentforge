/**
 * Skills Plugin for AgentForge
 *
 * Intercepts agent.start to scan SKILL.md files,
 * intercepts llm.request to inject skill metadata (progressive disclosure).
 *
 * Uses existing InterceptorPlugin interface - zero new concepts.
 *
 * @module
 */

import type { InterceptorPlugin, PluginContext } from '../plugins/plugin.js';
import type { AgentEvent, Message } from '../core/events.js';
import { SkillRegistry } from '../skill/loader.js';

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
 * Intercepts:
 * - agent.start: Scans skill directories, parses SKILL.md frontmatter
 * - llm.request: Prepends skill list (name + description only) to messages
 *
 * Priority: 5 (before Memory at 10, but Memory prepends AFTER so appears first)
 *
 * Progressive disclosure: Only metadata is injected. Model reads full SKILL.md on demand.
 *
 * @param sources - Skill directory paths
 * @returns InterceptorPlugin
 */
export function createSkillsPlugin(sources: string[]): InterceptorPlugin {
  const registry = new SkillRegistry();
  let skills: SkillMetadata[] = [];

  return {
    name: 'skills',
    type: 'interceptor' as const,
    priority: 5,
    eventTypes: ['agent.start', 'llm.request'],
    enabled: true,

    intercept(event: AgentEvent, _ctx: PluginContext): any {
      if (event.type === 'agent.start') {
        return registry.discover(sources).then(discovered => {
          skills = discovered.map(s => {
            const meta: SkillMetadata = { name: s.frontmatter.name, description: s.frontmatter.description, path: s.location };
            if (s.frontmatter.license !== undefined) meta.license = s.frontmatter.license;
            if (s.frontmatter.compatibility !== undefined) meta.compatibility = s.frontmatter.compatibility;
            if (s.frontmatter.allowedTools !== undefined) meta.allowedTools = s.frontmatter.allowedTools;
            return meta;
          });
          return event;
        });
      }

      if (event.type === 'llm.request' && skills.length > 0) {
        // Inject skill metadata (progressive disclosure)
        const skillsList = skills.map(s => {
          let line = `- **${s.name}**: ${s.description}`;
          if (s.license || s.compatibility) {
            const ann = [s.license && `License: ${s.license}`, s.compatibility && `Compatibility: ${s.compatibility}`]
              .filter(Boolean)
              .join(', ');
            line += ` (${ann})`;
          }
          if (s.allowedTools?.length) {
            line += `\n  -> Allowed tools: ${s.allowedTools.join(', ')}`;
          }
          line += `\n  -> Read \`${s.path}\` for full instructions`;
          return line;
        }).join('\n');

        const skillsMessage: Message = {
          role: 'system',
          content: `## Skills System\n\n**Available Skills:**\n\n${skillsList}`,
          name: 'skills',
        };

        return {
          ...event,
          messages: [skillsMessage, ...event.messages],
        };
      }

      return event;
    },
  };
}
