Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the SkillProcessor plugin following the agentskills.io standard, with progressive disclosure of skill summaries and on-demand loading of full instructions.

**SkillProcessor at buildContext:**
1. Scan skill directories for `SKILL.md` files
2. Parse YAML frontmatter: `name`, `description`, `trigger` (optional)
3. Inject skill summaries into the system prompt: `<skill name="X">description</skill>`
4. Register a `read_skill` tool that loads full skill content on demand

**Skill discovery paths (in priority order):**
1. Plugin-registered skills (from plugin directories)
2. Project directory: `.harness/skills/*/SKILL.md`
3. Global directory: `~/.harness/skills/*/SKILL.md`
4. Later sources override earlier ones with the same name

**read_skill tool:** When the agent decides to use a skill, it calls `read_skill({ name })` which returns the full SKILL.md content. The content is then part of the conversation context.

**Skill format:** Standard SKILL.md with YAML frontmatter:
```
---
name: my-skill
description: When to use this skill
---
# Full instructions here
```

## Acceptance criteria

- [ ] SkillProcessor discovers SKILL.md files from configured directories
- [ ] YAML frontmatter is parsed correctly (name, description)
- [ ] Skill summaries are injected into system prompt at buildContext
- [ ] `read_skill` tool loads full skill content on demand
- [ ] Later skill sources override earlier ones with the same name
- [ ] Test: agent discovers a skill, reads it on demand, uses the instructions

## Blocked by

- Issue 07 (Plugin System)

## User stories covered

42, 43, 44, 45
