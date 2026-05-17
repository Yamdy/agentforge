# AgentForge: .agents Directory Discovery & Global Config Loading

**Date:** 2026-05-17
**Scope:** CLI/Server only — no changes to framework public API (core, plugins, sdk)
**Motivation:** Align with the emerging `.agents` convention (pi-mono, opencode, oh-my-openagent, Gemini CLI) while keeping AgentForge's own `.agentforge` convention. Wire up documented but unimplemented global config, env var, and MCP file loading.

---

## 1. Skill Directory Discovery

### Scan Strategy

From cwd, walk upward to git repo root (fallback: filesystem root). At each level, collect skill directories for each enabled convention. Append user-level directories last (highest priority).

**Discovery order (low → high priority):**

| Priority | Source | Path Pattern |
|----------|--------|-------------|
| 1 (lowest) | Ancestor `.agentforge/skills/` | `<ancestor>/.agentforge/skills/*/SKILL.md` |
| 2 | Ancestor `.agents/skills/` | `<ancestor>/.agents/skills/*/SKILL.md` |
| 3 | Project `.agentforge/skills/` | `<cwd>/.agentforge/skills/*/SKILL.md` |
| 4 | Project `.agents/skills/` | `<cwd>/.agents/skills/*/SKILL.md` |
| 5 | User `.agentforge/skills/` | `~/.agentforge/skills/*/SKILL.md` |
| 6 (highest) | User `.agents/skills/` | `~/.agents/skills/*/SKILL.md` |
| 7 | Extra dirs | `--skill-dir` CLI argument paths |

Same-name skills in later directories override earlier ones.

### Controls

Three mechanisms to toggle conventions, checked in priority order:

1. **CLI flags:** `--no-agents-convention`, `--no-agentforge-convention`
2. **Project config:** `.agentforge/config.jsonc` → `discovery.agentsConvention: false` / `discovery.agentforgeConvention: false`
3. **Environment variables:** `AGENTFORGE_DISABLE_AGENTS=1`, `AGENTFORGE_DISABLE_AGENTFORGE=1`
4. **Default:** both conventions enabled

### Interface

```typescript
// packages/server/src/discovery.ts

export interface DiscoveryOptions {
  agentsConvention?: boolean;      // default: true
  agentforgeConvention?: boolean;  // default: true
  extraSkillDirs?: string[];       // highest priority
}

export function resolveSkillDirectories(
  cwd: string,
  home: string,
  options?: DiscoveryOptions
): string[]
```

Returns ordered directory list. Caller passes to existing `discoverSkills(directories, fs)` — no changes to `plugins` package.

Deduplication: resolve `realpath` on all directories, filter duplicates by resolved path.

---

## 2. Global Config Loading + Environment Variable

### Current Gap

`ConfigLoader` accepts `ConfigSource.global` and `ConfigSource.env`, but the CLI never passes them. Only project-level `.agentforge/config.jsonc` is loaded.

### Resolution

CLI auto-resolves all config sources and passes them to `ConfigLoader.load()`:

```
Priority (low → high):
1. AGENTFORGE_CONFIG env var (inline JSON)
2. ~/.agentforge/config.jsonc (global)
3. .agentforge/config.jsonc (project, existing behavior)
4. --config CLI flag (explicit override, existing)
```

### Interface

```typescript
// packages/server/src/discovery.ts

export interface ResolvedConfigSources {
  global?: string;    // ~/.agentforge/config.jsonc
  project?: string;   // .agentforge/config.jsonc or --config override
  env?: string;       // process.env.AGENTFORGE_CONFIG
}

export function resolveConfigSources(
  cwd: string,
  home: string,
  cliConfig?: string
): ResolvedConfigSources
```

When `cliConfig` is provided, it replaces the default project path. Missing global file is silently ignored (ConfigLoader already handles this).

---

## 3. MCP Configuration File

### Format

Aligns with Claude Code's `.claude/mcp.json` de-facto standard:

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-filesystem", "/tmp"],
      "env": { "DEBUG": "1" }
    },
    "remote-api": {
      "transport": "sse",
      "url": "http://localhost:3001/sse"
    }
  }
}
```

### File Locations

```
Priority (low → high):
1. ~/.agentforge/mcp.jsonc (global)
2. .agentforge/mcp.jsonc  (project)
```

Same-name servers in project config override global config.

### Interface

```typescript
// packages/server/src/discovery.ts

export async function resolveMcpServers(
  cwd: string,
  home: string,
  fs: SkillFileSystem
): Promise<McpServerConfig[]>
```

Returns `McpServerConfig[]` ready to pass to `mcpPlugin()`. Missing files are silently skipped.

---

## 4. CLI Integration

### Startup Sequence

Each CLI command (serve/run/dev) executes:

```
1. resolveConfigSources()     → global + env + project config paths
2. ConfigLoader.load()        → merged config (now includes global + env)
3. resolveSkillDirectories()  → skill dirs based on discovery options
4. discoverSkills()           → skill definitions from dirs
5. resolveMcpServers()        → MCP server configs from files
6. loadAndRegister()          → register agents with skills + MCP injected
```

### New CLI Arguments

```
--no-agents-convention       Disable .agents/ directory scanning
--no-agentforge-convention   Disable .agentforge/ directory scanning
--skill-dir <path>           Additional skill directory (repeatable)
```

### Modified CLI Flag Parsing

`parseCommand()` in `cli.ts` gains:
- `--no-agents-convention` → sets `agentsConvention: false`
- `--no-agentforge-convention` → sets `agentforgeConvention: false`
- `--skill-dir <path>` → appends to `extraSkillDirs: string[]`

These are threaded into `DiscoveryOptions` passed to `resolveSkillDirectories()`.

---

## 5. File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/server/src/discovery.ts` | **New** | `resolveSkillDirectories`, `resolveConfigSources`, `resolveMcpServers`, git root detection, realpath dedup |
| `packages/server/src/cli.ts` | **Modify** | Parse new CLI flags, call discovery functions, pass results to `loadAndRegister` |
| `packages/server/src/config-loader.ts` | **Modify** | Accept `skills` and `mcpServers` params, inject into agent plugin chain |
| `packages/server/__tests__/discovery.test.ts` | **New** | Tests for directory resolution, config source resolution, MCP loading, toggle controls |

**No changes to:** `packages/core/`, `packages/plugins/`, `packages/sdk/`, `packages/tools/`, `packages/observability/`.

---

## 6. Resulting User-Facing Directory Structure

```
~/.agentforge/
  config.jsonc              Global config (agents, modelGateways, discovery toggles)
  mcp.jsonc                 Global MCP servers

<project>/
  .agentforge/
    config.jsonc            Project config (existing)
    mcp.jsonc               Project MCP servers (new)
    skills/                 Project skills (existing convention, now auto-discovered)
      my-skill/
        SKILL.md
  .agents/
    skills/                 Cross-tool convention skills (new)
      shared-skill/
        SKILL.md
```
