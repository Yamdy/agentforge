Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement JSONC configuration with multi-level merging, ModelProfile per-model behavior, and Dynamic config resolution.

**Config interface:**
```typescript
interface HarnessConfig {
  agents?: Record<string, Partial<AgentConfig>>;
  tools?: { enabled?: string[]; disabled?: string[] };
  plugins?: string[];
  session?: { storage?: 'file' | 'memory'; path?: string };
  modelProfiles?: ModelProfile[];
  modelGateways?: ModelGateway[];
}
```

**Multi-level merge (highest priority first):**
1. Session-level — runtime parameters passed to agent.run()
2. Project-level — `.agentforge/config.jsonc` in project root
3. Global-level — `~/.agentforge/config.jsonc` in user home
4. Environment — `AGENTFORGE_CONFIG` env var (inline JSON)

**ModelProfile (from DeepAgents insight):**
```typescript
interface ModelProfile {
  modelPattern: string | RegExp;
  systemPromptSuffix?: string;
  toolOverrides?: { [toolName: string]: { description?: string; exclude?: boolean } };
  extraPromptFragments?: PromptFragment[];
}
```

Applied at `buildContext` when current model matches profile pattern. Supports `anthropic/*`, `openai/gpt-*`, exact model IDs, etc.

**Dynamic config resolution (from Mastra insight):** `Dynamic<T> = T | ((ctx) => T)` — fields in AgentConfig accept functions resolved per-request at `processInput` stage.

## Acceptance criteria

- [ ] JSONC files parsed correctly (comments stripped)
- [ ] Multi-level merge: session > project > global > env
- [ ] Invalid config produces clear Zod validation errors with file path
- [ ] ModelProfile lookup resolves by pattern match
- [ ] Profile systemPromptSuffix appended to agent system prompt
- [ ] Profile toolOverrides correctly exclude/modify tools
- [ ] Dynamic config fields resolved at processInput stage
- [ ] Test: project config overrides global, ModelProfile adapts behavior per model

## Blocked by

- Plan A (Foundation — Dynamic type, ModelProfile type)

## User stories covered

49, 50, 51
