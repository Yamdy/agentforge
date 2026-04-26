# create-agentforge CLI Design Spec

## Goal

Build a scaffold CLI tool (`create-agentforge`) for AgentForge that generates fully runnable, configurable agent projects. Developers configure modules interactively or via CLI flags, and the tool generates a complete project with TypeScript config file (`agentforge.config.ts`) + modular source files that can be modified at runtime to change agent behavior.

## Architecture

**Hybrid template + snippet injection (Plan C):** A base template provides the project skeleton. Module snippets are conditionally injected based on user configuration. Handlebars templates render all files. A `defineConfig()` TypeScript config file serves as the single source of truth for module wiring, enabling runtime behavior changes by editing config values or swapping module implementations.

**Comparison with existing frameworks:**

| Aspect | CrewAI | LangGraph | Mastra | DeepAgents | AgentForge |
|--------|--------|-----------|--------|------------|------------|
| Config format | YAML | JSON | TypeScript | SKILL.md | TypeScript (defineConfig) |
| Module selection | Fixed template | Fixed template | Component picker | Skill create | 10-module picker |
| Template mechanism | Jinja inline | GitHub clone | Hybrid (clone+generate) | Single file | Handlebars + snippet injection |
| Runtime config changes | Edit YAML | Edit JSON | Edit TS config | Edit SKILL.md | Edit TS config + swap modules |
| Dev server | `crewai deploy` | `langgraph dev` | `mastra dev` | N/A | `agentforge dev` |

## Design Decisions (Confirmed)

1. **Interactive mode:** Mixed — interactive by default, `--default` for quick start, `--llm`/`--tools` etc. for pre-fill
2. **API level:** Mixed — L2 (`createAgent`) for simple, L3 (`AgentContextBuilder`) for advanced
3. **Tech stack:** TypeScript + Commander + inquirer
4. **Module config:** All 10 modules — LLM, tools, checkpoint, observability, preset, HITL, plugins, compaction, subagent, MCP
5. **Architecture:** Hybrid template + snippet injection
6. **Config layers:** 2-layer — project config (`agentforge.config.ts`) as single source of truth + environment secrets (`.env`). No global config file (use env vars for global settings like API keys).
7. **Config format:** TypeScript with `defineConfig()`
8. **Package scripts:** dev/start/build/test
9. **Dev server:** `agentforge dev` with watch + event visualization
10. **Template engine:** Handlebars

## CLI Commands

```bash
# Interactive (default)
npx create-agentforge

# With project name
npx create-agentforge my-agent

# Full flags (skip interactive)
npx create-agentforge my-agent \
  --llm openai \
  --tools weather,calculator \
  --checkpoint \
  --observability \
  --preset production \
  --hitl \
  --plugins \
  --compaction \
  --subagent \
  --mcp \
  --api-mode advanced

# Quick start with defaults
npx create-agentforge my-agent --default

# From template
npx create-agentforge --template weather-agent
```

### Commander Options

```
[project-name]              Project directory name
--default                   Use defaults (skip prompts)
--llm <provider>            openai|anthropic|deepseek|mock
--tools <list>              Comma-separated: weather,calculator
--checkpoint                Enable checkpoint persistence
--observability             Enable Logger+Tracer+Metrics
--preset <name>             production|debug|test
--hitl                      Enable human-in-the-loop
--plugins                   Enable plugin system
--compaction                Enable memory compaction
--subagent                  Enable sub-agent delegation
--mcp                       Enable MCP client
--api-mode <mode>           simple(L2)|advanced(L3)
--template <name>           Create from example template
--dry-run                   Preview files to be created without writing
--skip-install              Skip npm install step
```

## Package Structure

```
packages/create-agentforge/
├── package.json                # bin: { "create-agentforge": "./dist/index.js" }
├── tsconfig.json
├── src/
│   ├── index.ts               # Entry: Commander → main flow
│   ├── prompts.ts              # Interactive prompts (inquirer)
│   ├── generator.ts            # Core: read config → template + snippets → write files
│   ├── config.ts               # PromptsConfig type + defaults
│   ├── deps.ts                 # Dependency calculator
│   ├── post-install.ts         # git init / npm install / prettier
│   └── utils.ts                # File ops, template rendering
├── templates/
│   ├── base/                   # Base skeleton (always rendered)
│   │   ├── package.json.hbs
│   │   ├── tsconfig.json.hbs
│   │   ├── .env.example.hbs
│   │   ├── .gitignore
│   │   ├── README.md.hbs
│   │   └── src/
│   │       ├── index.ts.hbs            # L2 or L3 entry (conditional)
│   │       └── types.ts                # Shared types
│   └── modules/               # Pluggable module snippets
│       ├── llm-openai/
│       │   └── adapter.ts.hbs
│       ├── llm-anthropic/
│       │   └── adapter.ts.hbs
│       ├── llm-deepseek/
│       │   └── adapter.ts.hbs
│       ├── llm-mock/
│       │   └── adapter.ts.hbs
│       ├── tools/
│       │   ├── index.ts.hbs
│       │   └── weather.ts.hbs
│       ├── checkpoint/
│       │   └── storage.ts.hbs
│       ├── observability/
│       │   ├── logger.ts.hbs
│       │   ├── tracer.ts.hbs
│       │   └── metrics.ts.hbs
│       ├── hitl/
│       │   └── controller.ts.hbs
│       ├── plugins/
│       │   └── index.ts.hbs
│       ├── memory/
│       │   └── compaction.ts.hbs
│       ├── subagent/
│       │   └── registry.ts.hbs
│       ├── mcp/
│       │   └── client.ts.hbs
│       └── operators/
│           └── pipeline.ts.hbs
└── examples/
    ├── weather-agent/         # Simple template (clone-ready)
    └── full-pipeline/         # Full-featured template (clone-ready)
```

## Generated Project Structure

**Only selected modules generate directories.** Unselected modules do NOT create empty dirs. This keeps the project clean for simple agents.

Example: `--llm openai --tools` generates:
```
my-agent/
├── agentforge.config.ts
├── package.json
├── tsconfig.json
├── .env / .env.example / .gitignore
├── README.md
└── src/
    ├── index.ts            # L2 entry
    ├── types.ts
    ├── llm/
    │   └── adapter.ts      # OpenAI adapter
    └── tools/
        ├── index.ts
        └── weather.ts
```

Example: `--llm openai --tools --checkpoint --observability --api-mode advanced` generates:
```
my-agent/
├── agentforge.config.ts
├── package.json
├── tsconfig.json
├── .env / .env.example / .gitignore
├── README.md
└── src/
    ├── index.ts            # L3 entry with full pipeline
    ├── types.ts
    ├── llm/
    │   └── adapter.ts
    ├── tools/
    │   ├── index.ts
    │   └── weather.ts
    ├── checkpoint/
    │   └── storage.ts      # SQLite by default
    ├── observability/
    │   ├── logger.ts
    │   ├── tracer.ts
    │   └── metrics.ts
    └── operators/
        └── pipeline.ts
```

## defineConfig() System

```typescript
// agentforge.config.ts
import { defineConfig } from 'agentforge';
import { tools } from './src/tools/index.js';
import { checkpointStorage } from './src/checkpoint/storage.js';
import { logger, tracer, metrics } from './src/observability/index.js';

export default defineConfig({
  name: 'my-agent',
  model: 'openai/gpt-4o',      // String shorthand or object
  maxSteps: 10,

  tools,                         // Imported from module
  checkpoint: true,              // true → SQLite (production-safe); 'memory' → InMemory (dev)
  tracing: true,                 // true → ConsoleTracer
  metrics: true,                 // true → ConsoleMetrics
  preset: 'production',          // production|debug|test
  hitl: true,                    // true → DefaultHITLController (terminal-based approval)
  // compaction: true,           // Uncomment to enable
  // subagents: [...],           // Uncomment to enable
  // mcp: [...],                 // Uncomment to enable
});
```

Boolean shorthand maps to **production-safe defaults**, not toy implementations:
- `checkpoint: true` → SQLite storage at `./agentforge.db` (durable, survives restarts)
- `checkpoint: 'memory'` → InMemory (development only, data lost on restart — explicit opt-in)
- `tracing: true` → ConsoleTracer (always safe)
- `metrics: true` → ConsoleMetrics (always safe)
- `hitl: true` → DefaultHITLController with terminal-based approval

Object form provides full control:
- `checkpoint: { storage: 'sqlite', path: './custom.db' }` → custom SQLite config
- `checkpoint: { storage: 'custom', impl: myStorage }` → custom implementation

## Dependency Calculation

| CLI Flag | npm Dependencies Added |
|----------|----------------------|
| `--llm openai` | `@ai-sdk/openai`, `ai` |
| `--llm anthropic` | `@ai-sdk/anthropic`, `ai` |
| `--llm deepseek` | `@ai-sdk/openai-compatible`, `ai` |
| `--llm mock` | (none) |
| `--checkpoint` | `better-sqlite3`, `@types/better-sqlite3` |
| `--checkpoint` with `'memory'` | (none — uses InMemory) |
| `--mcp` | `@modelcontextprotocol/sdk` |
| `--observability` with otlp | `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http` |
| Always | `agentforge`, `rxjs`, `zod`, `dotenv`, `typescript`, `tsx`, `vitest` |
| Always (CLI dev deps) | `chalk` |

## Multi-Tier Config Merging

**Simplified to 2 layers** — no global config, no local config overrides. Environment variables for secrets only.

```
agentforge.config.ts    ← Single source of truth (version-controlled, defines all behavior)
.env                    ← Secrets only (API keys, endpoints) — gitignored
```

Rationale: Global `~/.agentforge/config.ts` adds complexity without clear benefit. API keys and endpoints vary by project and environment, which `.env` already handles. Behavioral configuration (model, tools, checkpoint, etc.) belongs in the project config where it's version-controlled and shared with the team.

```typescript
// .env (secrets only, gitignored)
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-yyy
DEEPSEEK_API_KEY=sk-zzz

// agentforge.config.ts (behavior, version-controlled)
export default defineConfig({
  model: 'openai/gpt-4o',  // Provider inferred; API key from .env
  ...
});
```

Deep merge is NOT needed — the config file is the single source, `.env` provides env-specific secrets via `process.env`.

## Interactive Prompt Flow

```
 1. Project name? (if not provided via arg)
 2. Agent name? (default: project-name)
 3. Max steps? [10]
 4. Select LLM provider: OpenAI / Anthropic / DeepSeek / Mock
 5. Enter API key? (or skip — add to .env later)
 6. Select modules: ☐ Tools ☐ Checkpoint ☐ Observability ☐ Preset ☐ HITL ☐ Plugins ☐ Compaction ☐ SubAgent ☐ MCP
 7. Select preset? (if Observability or Preset enabled): production / debug / test
 8. Select checkpoint storage? (if Checkpoint enabled): SQLite / InMemory (dev-only)
 9. Select API mode: Simple (L2) / Advanced (L3)
10. Initialize git repo? yes/no
```

### --default Values

When `--default` is used, these defaults are applied without prompting:

| Option | Default |
|--------|---------|
| Agent name | project-name |
| Max steps | 10 |
| LLM | openai (gpt-4o) |
| Tools | none |
| Checkpoint | disabled |
| Observability | disabled |
| Preset | disabled |
| HITL | disabled |
| Plugins | disabled |
| Compaction | disabled |
| Subagent | disabled |
| MCP | disabled |
| API mode | simple (L2) |
| Git init | yes |

## Error Handling

| Scenario | CLI Behavior |
|----------|--------------|
| Invalid `--llm` value | Exit code 1 + error message listing valid options (openai, anthropic, deepseek, mock) |
| Invalid `--preset` value | Exit code 1 + error message listing valid options (production, debug, test) |
| Invalid `--api-mode` value | Exit code 1 + error message listing valid options (simple, advanced) |
| Target directory exists & non-empty | Prompt: overwrite? / merge? / abort? (default: abort) |
| Target directory exists & empty | Proceed without prompt |
| npm install fails | Print error, offer: retry / skip (continue with warning) / abort |
| Template not found (`--template`) | Exit code 1 + error listing available templates |
| User cancels prompts (Ctrl+C) | Atomic rollback: remove temp directory, target directory untouched |
| Missing required field after prompts | Re-prompt with validation message |
| `.env` already exists | Skip, print warning that existing .env was preserved |

### Atomic File Generation

All files are generated in a **temporary directory** first, then atomically moved to the target on success. This ensures Ctrl+C or errors never leave partial state.

```typescript
// generator.ts flow:
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentforge-'));
try {
  // 1. Render all templates into tempDir
  // 2. Write all module snippets into tempDir
  // 3. Run npm install in tempDir (if not --skip-install)
  // 4. Git init in tempDir (if requested)
  // 5. Atomic move: fs.rename(tempDir, targetDir)
} catch (error) {
  // Rollback: fs.rm(tempDir, { recursive: true })
  throw error;
}
```

Key rules:
- Target directory is never modified until all generation succeeds
- If `fs.rename` crosses filesystem boundaries, fall back to `fs.cp` + `fs.rm`
- `--dry-run` renders everything but skips the final `fs.rename`

## Acceptance Criteria

- [x] Running `npx create-agentforge my-agent --default` produces a project that `npm run dev` executes without error
- [x] Running `npx create-agentforge my-agent --llm openai` prompts for remaining options interactively
- [x] Running `npx create-agentforge my-agent --llm openai --tools --checkpoint --observability --default` generates all expected module files in correct locations
- [x] Generated `agentforge.config.ts` compiles without TypeScript errors
- [x] Generated `npm run build` exits with code 0
- [x] Each `--llm <provider>` flag generates the correct adapter file (openai/anthropic/deepseek/mock)
- [x] `--llm invalid` exits with error and valid options list
- [x] Target directory that already exists prompts user (overwrite/merge/abort)
- [x] Ctrl+C during prompts removes partially created directory (atomic rollback)
- [x] `defineConfig()` with boolean shorthands (`checkpoint: true`) resolves to default implementations
- [x] `defineConfig()` with object forms (`checkpoint: { storage: 'sqlite' }`) resolves correctly

## CLI Dependencies

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "inquirer": "^10.0.0",
    "handlebars": "^4.7.8"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0"
  }
}
```

## Dev Server Mode

```bash
agentforge dev              # tsx watch src/index.ts (default: console output)
agentforge dev --log-format json    # Structured JSON logs (machine-parseable)
agentforge dev --log-level debug    # Verbose: all events, full payloads
agentforge dev --otlp-endpoint http://localhost:4318  # Export to OpenTelemetry collector

agentforge build            # tsc → dist/
agentforge start            # node dist/index.js
```

**Console output** (default): colored per event type — `agent.*` cyan, `llm.*` blue, `tool.*` green, `hitl.*` yellow, `agent.error` red, `done` gray. Format: `[timestamp] event.type — payload summary`

**JSON output** (`--log-format json`): one JSON object per line, full event payload. Suitable for piping to `jq`, log aggregators, etc.

## Generated tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "agentforge.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## Example Templates

Two complete example projects available via `--template`:

| Template | Description | Modules Included | API Mode |
|----------|-------------|-----------------|----------|
| `weather-agent` | Simple weather query agent | LLM (OpenAI) + Tools (weather) | Simple (L2) |
| `full-pipeline` | Full-featured agent demo | All 10 modules, SQLite checkpoint | Advanced (L3) |

---

## Review Changelog

### Review 1 (2026-04-26) — Expert Review

**Changes applied:**

| Issue | Severity | Resolution |
|-------|----------|------------|
| Config 5-layer vs "single source" contradiction | P0 | Simplified to 2 layers: `agentforge.config.ts` (behavior, version-controlled) + `.env` (secrets, gitignored). Removed `~/.agentforge/config.ts` and `.agentforge/local.ts`. |
| Ctrl+C rollback unreliable | P0 | Changed to atomic temp dir approach: all generation in temp dir, `fs.rename` on success, `fs.rm` on failure. |
| Boolean shorthand `checkpoint: true` → InMemory (not production-safe) | P1 | Changed: `checkpoint: true` → SQLite (production-safe). Added `checkpoint: 'memory'` as explicit dev-only opt-in. |
| Missing dependencies (dotenv, chalk, lodash.merge) | P1 | Added `dotenv` and `chalk` to always-install. Removed `lodash.merge` (no longer needed with 2-layer config). Added OTLP deps for observability. |
| Interactive prompts incomplete (no agent name, maxSteps) | P2 | Added steps 2-3: Agent name, Max steps. |
| No --dry-run mode | P2 | Added `--dry-run` flag and `--skip-install` flag. |
| Over-complex template (empty dirs for unselected modules) | P2 | Changed: only selected modules generate directories. Removed static full structure in favor of dynamic examples. |
| Event visualization too simple | P3 | Added `--log-format json` and `--otlp-endpoint` options. |
| --default values undefined | P3 | Added complete default values table. |
| tsconfig.json generation underspecified | P3 | Added full tsconfig.json content. |

**Deferred to v2:**
- Plugin-based template system (community modules via `agentforge-module.json`)
- `agentforge upgrade` command
- Custom module authoring guide