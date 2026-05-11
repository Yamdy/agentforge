Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the SkillProcessor plugin with progressive disclosure, resource co-location, and agentskills.io standard.

**Skill definition:**
```typescript
interface SkillDefinition {
  name: string;
  description: string;
  content: string;                  // SKILL.md content
  resources?: ResourceDeclaration[]; // skill-associated resources (e.g., MCP servers)
  tools?: ToolDefinition[];          // skill-provided tools
}
```

**SkillProcessor at buildContext:**
1. Discover SKILL.md files from `.agentforge/skills/*/SKILL.md`
2. Parse YAML frontmatter (name, description)
3. Inject skill summaries as PromptFragment (role: 'instruction', source: 'skill-plugin')
4. Register associated resources via HarnessAPI.registerResource()
5. Register associated tools via HarnessAPI.registerTool()
6. Provide `read_skill` tool for on-demand full content loading

**Skill + MCP co-location (from oh-my-openagent insight):** Skills can declare MCP servers they need. The MCP Plugin manages server lifecycle. Skill activates → MCP server starts → tools available. Skill deactivates → MCP server stops. Prevents all MCPs running simultaneously.

## Acceptance criteria

- [ ] SkillProcessor discovers SKILL.md files from configured directories
- [ ] YAML frontmatter parsed correctly (name, description)
- [ ] Skill summaries injected as PromptFragment at buildContext
- [ ] `read_skill` tool loads full content on demand
- [ ] Skill resources are registered and started with plugin
- [ ] Skill tools are registered and callable by agent
- [ ] Later skill sources override earlier ones with same name
- [ ] Test: agent discovers skill, reads on demand, uses instructions

## Blocked by

- Issue 07 (Plugin System — registerResource)
- Plan A (Foundation — PromptFragment type)

## User stories covered

42, 43, 44, 45
