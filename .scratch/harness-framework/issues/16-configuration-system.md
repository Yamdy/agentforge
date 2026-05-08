Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the configuration system with JSONC multi-level merging and HarnessProfile per provider/model runtime behavior.

**JSONC parser:** Parse JSON with comments (strip comments before JSON.parse). Used for all config files.

**Multi-level merging (priority: highest to lowest):**
1. **Session-level** — runtime parameters passed to agent.run()
2. **Project-level** — `.harness/config.jsonc` in the project root
3. **Global-level** — `~/.harness/config.jsonc` in user home

**Merge rules:**
- Scalars: higher priority overrides lower
- Arrays: higher priority replaces lower (not concatenated)
- Objects: deep merge, higher priority keys override

**Zod validation:** All config is validated against a Zod schema at load time. Invalid config produces clear error messages with the file path and field name.

**HarnessProfile:** A config section keyed by `'provider'` or `'provider:model'` that overrides runtime behavior:
- `systemPromptSuffix` — appended to system prompt
- `toolExclusions` — list of tool names to disable
- `processorOverrides` — add or remove Processors
- `modelParameters` — temperature, topP, maxTokens overrides

When an agent is created with model `'openai/gpt-5'`, the framework looks up profiles in order: `'openai/gpt-5'` → `'openai'` → default.

## Acceptance criteria

- [ ] JSONC files are parsed correctly (comments stripped, valid JSON produced)
- [ ] Multi-level merge produces correct result (session > project > global)
- [ ] Invalid config produces clear Zod validation errors with file path
- [ ] HarnessProfile lookup resolves by provider:model → provider → default
- [ ] Profile systemPromptSuffix is correctly appended to agent's system prompt
- [ ] Profile toolExclusions correctly remove tools from the agent's tool list
- [ ] Test: project config overrides global config, HarnessProfile adapts agent behavior per model

## Blocked by

- Issue 01 (Monorepo Scaffolding + Core Types)
- Issue 07 (Plugin System)

## User stories covered

49, 50, 51
