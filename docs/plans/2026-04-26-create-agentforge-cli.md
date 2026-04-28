# create-agentforge CLI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `create-agentforge` scaffold CLI tool that generates fully runnable, configurable agent projects from templates + module snippets, with a `defineConfig()` TypeScript config system.

**Architecture:** Hybrid template + snippet injection (Plan C). A base template provides the project skeleton. Module snippets are conditionally injected based on user configuration. All generation happens in a temp directory first, then atomically moved to target. Handlebars renders `.hbs` templates. TypeScript + Commander + inquirer for the CLI.

**Tech Stack:** TypeScript 5.5+, Commander 12, inquirer 10, Handlebars 4.7, vitest for testing

**Spec:** `docs/superpowers/specs/2026-04-26-create-agentforge-cli-design.md`

---

## File Structure

```
packages/create-agentforge/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                  # Entry: Commander setup → main()
│   ├── prompts.ts                 # Interactive inquirer prompts
│   ├── generator.ts              # Core: config → template → snippets → write files
│   ├── config.ts                  # PromptsConfig type + defaults + validation
│   ├── deps.ts                    # Dependency calculator
│   ├── post-install.ts           # git init / npm install / prettier
│   ├── utils.ts                  # File ops, Handlebars helpers, atomic move
│   └── __tests__/
│       ├── config.test.ts         # Config defaults + validation tests
│       ├── deps.test.ts           # Dependency calculation tests
│       ├── generator.test.ts      # Template rendering + file generation tests
│       ├── prompts.test.ts        # Prompt flow tests
│       └── utils.test.ts          # Utility function tests
├── templates/
│   ├── base/
│   │   ├── package.json.hbs
│   │   ├── tsconfig.json.hbs
│   │   ├── .env.example.hbs
│   │   ├── .gitignore
│   │   ├── README.md.hbs
│   │   └── src/
│   │       ├── index.ts.hbs
│   │       └── types.ts
│   └── modules/
│       ├── llm-openai/adapter.ts.hbs
│       ├── llm-anthropic/adapter.ts.hbs
│       ├── llm-deepseek/adapter.ts.hbs
│       ├── llm-mock/adapter.ts.hbs
│       ├── tools/index.ts.hbs
│       ├── tools/weather.ts.hbs
│       ├── checkpoint/storage.ts.hbs
│       ├── observability/logger.ts.hbs
│       ├── observability/tracer.ts.hbs
│       ├── observability/metrics.ts.hbs
│       ├── hitl/controller.ts.hbs
│       ├── plugins/index.ts.hbs
│       ├── memory/compaction.ts.hbs
│       ├── subagent/registry.ts.hbs
│       ├── mcp/client.ts.hbs
│       └── operators/pipeline.ts.hbs
└── examples/
    ├── weather-agent/
    │   ├── agentforge.config.ts
    │   ├── package.json
    │   ├── .env.example
    │   └── src/
    │       ├── index.ts
    │       └── tools/
    │           └── weather.ts
    └── full-pipeline/
        ├── agentforge.config.ts
        ├── package.json
        ├── .env.example
        └── src/
            ├── index.ts
            ├── tools/
            ├── checkpoint/
            ├── observability/
            └── operators/
```

---

## Chunk 1: Config, Defaults, and Validation

### Task 1: PromptsConfig Type and Defaults

**Files:**
- Create: `packages/create-agentforge/src/config.ts`
- Test: `packages/create-agentforge/src/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/config.test.ts
import { describe, it, expect } from 'vitest';
import {
  PromptsConfig,
  DEFAULT_CONFIG,
  validateConfig,
  VALID_LLM_PROVIDERS,
  VALID_PRESETS,
  VALID_API_MODES,
  DEFAULT_VALUES,
} from '../config.js';

describe('config', () => {
  describe('DEFAULT_VALUES', () => {
    it('has correct defaults', () => {
      expect(DEFAULT_VALUES.agentName).toBe('');
      expect(DEFAULT_VALUES.maxSteps).toBe(10);
      expect(DEFAULT_VALUES.llm).toBe('openai');
      expect(DEFAULT_VALUES.llmModel).toBe('gpt-4o');
      expect(DEFAULT_VALUES.checkpoint).toBe(false);
      expect(DEFAULT_VALUES.observability).toBe(false);
      expect(DEFAULT_VALUES.preset).toBeUndefined();
      expect(DEFAULT_VALUES.hitl).toBe(false);
      expect(DEFAULT_VALUES.plugins).toBe(false);
      expect(DEFAULT_VALUES.compaction).toBe(false);
      expect(DEFAULT_VALUES.subagent).toBe(false);
      expect(DEFAULT_VALUES.mcp).toBe(false);
      expect(DEFAULT_VALUES.apiMode).toBe('simple');
      expect(DEFAULT_VALUES.gitInit).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('accepts valid config', () => {
      const config: PromptsConfig = {
        projectName: 'my-agent',
        llm: 'openai',
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('rejects invalid LLM provider', () => {
      const config = { projectName: 'my-agent', llm: 'invalid' as any };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('llm'));
    });

    it('rejects empty project name', () => {
      const config = { projectName: '', llm: 'openai' };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('rejects project name with spaces', () => {
      const config = { projectName: 'my agent', llm: 'openai' };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('fills defaults for --default mode', () => {
      const config = DEFAULT_CONFIG;
      expect(config.llm).toBe('openai');
      expect(config.apiMode).toBe('simple');
    });
  });

  describe('VALID_LLM_PROVIDERS', () => {
    it('contains expected providers', () => {
      expect(VALID_LLM_PROVIDERS).toEqual(['openai', 'anthropic', 'deepseek', 'mock']);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/create-agentforge/src/__tests__/config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement config.ts**

```typescript
// src/config.ts
export const VALID_LLM_PROVIDERS = ['openai', 'anthropic', 'deepseek', 'mock'] as const;
export const VALID_PRESETS = ['production', 'debug', 'test'] as const;
export const VALID_API_MODES = ['simple', 'advanced'] as const;
export const VALID_CHECKPOINT_STORAGE = ['sqlite', 'memory'] as const;
export const VALID_LLM_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4',
  deepseek: 'deepseek-chat',
  mock: 'mock-v1',
};

export type LLMProvider = (typeof VALID_LLM_PROVIDERS)[number];
export type Preset = (typeof VALID_PRESETS)[number];
export type APIMode = (typeof VALID_API_MODES)[number];
export type CheckpointStorage = (typeof VALID_CHECKPOINT_STORAGE)[number];

export interface PromptsConfig {
  projectName: string;
  agentName: string;
  maxSteps: number;
  llm: LLMProvider;
  llmModel: string;
  apiKey?: string;
  tools: boolean;
  toolList: string[];
  checkpoint: boolean;
  checkpointStorage: CheckpointStorage;
  observability: boolean;
  preset?: Preset;
  hitl: boolean;
  plugins: boolean;
  compaction: boolean;
  subagent: boolean;
  mcp: boolean;
  apiMode: APIMode;
  gitInit: boolean;
}

export const DEFAULT_VALUES = {
  agentName: '',
  maxSteps: 10,
  llm: 'openai' as const,
  llmModel: 'gpt-4o',
  tools: false,
  toolList: [] as string[],
  checkpoint: false,
  checkpointStorage: 'sqlite' as const,
  observability: false,
  hitl: false,
  plugins: false,
  compaction: false,
  subagent: false,
  mcp: false,
  apiMode: 'simple' as const,
  gitInit: true,
};

export const DEFAULT_CONFIG: PromptsConfig = {
  projectName: '',
  agentName: '',
  maxSteps: DEFAULT_VALUES.maxSteps,
  llm: DEFAULT_VALUES.llm,
  llmModel: DEFAULT_VALUES.llmModel,
  tools: DEFAULT_VALUES.tools,
  toolList: DEFAULT_VALUES.toolList,
  checkpoint: DEFAULT_VALUES.checkpoint,
  checkpointStorage: DEFAULT_VALUES.checkpointStorage,
  observability: DEFAULT_VALUES.observability,
  hitl: DEFAULT_VALUES.hitl,
  plugins: DEFAULT_VALUES.plugins,
  compaction: DEFAULT_VALUES.compaction,
  subagent: DEFAULT_VALUES.subagent,
  mcp: DEFAULT_VALUES.mcp,
  apiMode: DEFAULT_VALUES.apiMode,
  gitInit: DEFAULT_VALUES.gitInit,
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateConfig(config: Partial<PromptsConfig>): ValidationResult {
  const errors: string[] = [];

  if (!config.projectName || config.projectName.trim() === '') {
    errors.push('Project name is required');
  } else if (/\s/.test(config.projectName)) {
    errors.push('Project name cannot contain spaces');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(config.projectName)) {
    errors.push('Project name can only contain letters, numbers, hyphens, and underscores');
  }

  if (config.llm && !VALID_LLM_PROVIDERS.includes(config.llm)) {
    errors.push(`Invalid LLM provider "${config.llm}". Valid: ${VALID_LLM_PROVIDERS.join(', ')}`);
  }

  if (config.preset && !VALID_PRESETS.includes(config.preset)) {
    errors.push(`Invalid preset "${config.preset}". Valid: ${VALID_PRESETS.join(', ')}`);
  }

  if (config.apiMode && !VALID_API_MODES.includes(config.apiMode)) {
    errors.push(`Invalid API mode "${config.apiMode}". Valid: ${VALID_API_MODES.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/create-agentforge/src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/create-agentforge/src/config.ts packages/create-agentforge/src/__tests__/config.test.ts
git commit -m "feat(create-agentforge): add config types, defaults, and validation"
```

---

### Task 2: Dependency Calculator

**Files:**
- Create: `packages/create-agentforge/src/deps.ts`
- Test: `packages/create-agentforge/src/__tests__/deps.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/deps.test.ts
import { describe, it, expect } from 'vitest';
import { computeDependencies, computeDevDependencies } from '../deps.js';
import type { PromptsConfig } from '../config.js';
import { DEFAULT_CONFIG } from '../config.js';

describe('deps', () => {
  describe('computeDependencies', () => {
    it('includes core deps for minimal config', () => {
      const config = { ...DEFAULT_CONFIG, projectName: 'test', llm: 'mock' as const };
      const deps = computeDependencies(config);
      expect(deps).toHaveProperty('agentforge');
      expect(deps).toHaveProperty('rxjs');
      expect(deps).toHaveProperty('zod');
      expect(deps).toHaveProperty('dotenv');
      expect(deps).not.toHaveProperty('@ai-sdk/openai');
    });

    it('adds openai deps when llm is openai', () => {
      const config = { ...DEFAULT_CONFIG, projectName: 'test', llm: 'openai' as const };
      const deps = computeDependencies(config);
      expect(deps).toHaveProperty('@ai-sdk/openai');
      expect(deps).toHaveProperty('ai');
    });

    it('adds anthropic deps when llm is anthropic', () => {
      const config = { ...DEFAULT_CONFIG, projectName: 'test', llm: 'anthropic' as const };
      const deps = computeDependencies(config);
      expect(deps).toHaveProperty('@ai-sdk/anthropic');
    });

    it('adds deepseek deps when llm is deepseek', () => {
      const config = { ...DEFAULT_CONFIG, projectName: 'test', llm: 'deepseek' as const };
      const deps = computeDependencies(config);
      expect(deps).toHaveProperty('@ai-sdk/openai-compatible');
    });

    it('adds sqlite deps when checkpoint enabled', () => {
      const config = { ...DEFAULT_CONFIG, projectName: 'test', llm: 'mock' as const, checkpoint: true };
      const deps = computeDependencies(config);
      expect(deps).toHaveProperty('better-sqlite3');
    });

    it('adds mcp deps when mcp enabled', () => {
      const config = { ...DEFAULT_CONFIG, projectName: 'test', llm: 'mock' as const, mcp: true };
      const deps = computeDependencies(config);
      expect(deps).toHaveProperty('@modelcontextprotocol/sdk');
    });

    it('adds chalk for dev server output', () => {
      const config = { ...DEFAULT_CONFIG, projectName: 'test', llm: 'mock' as const };
      const devDeps = computeDevDependencies(config);
      expect(devDeps).toHaveProperty('chalk');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/create-agentforge/src/__tests__/deps.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement deps.ts**

```typescript
// src/deps.ts
import type { PromptsConfig } from './config.js';

const CORE_DEPS: Record<string, string> = {
  agentforge: '^0.1.0',
  rxjs: '^7.8.1',
  zod: '^3.23.8',
  dotenv: '^16.4.0',
};

const LLM_DEPS: Record<string, Record<string, string>> = {
  openai: { '@ai-sdk/openai': '^1.0.0', ai: '^6.0.0' },
  anthropic: { '@ai-sdk/anthropic': '^1.0.0', ai: '^6.0.0' },
  deepseek: { '@ai-sdk/openai-compatible': '^2.0.0', ai: '^6.0.0' },
  mock: {},
};

const MODULE_DEPS: Record<string, Record<string, string>> = {
  checkpoint: { 'better-sqlite3': '^11.0.0', '@types/better-sqlite3': '^7.6.0' },
  mcp: { '@modelcontextprotocol/sdk': '^1.29.0' },
};

export function computeDependencies(config: PromptsConfig): Record<string, string> {
  const deps: Record<string, string> = { ...CORE_DEPS };

  // LLM provider deps
  const llmDeps = LLM_DEPS[config.llm];
  if (llmDeps) Object.assign(deps, llmDeps);

  // Module deps
  if (config.checkpoint) Object.assign(deps, MODULE_DEPS.checkpoint);
  if (config.mcp) Object.assign(deps, MODULE_DEPS.mcp);

  return deps;
}

export function computeDevDependencies(_config: PromptsConfig): Record<string, string> {
  return {
    typescript: '^5.5.0',
    '@types/node': '^22.0.0',
    tsx: '^4.19.0',
    vitest: '^2.0.0',
    chalk: '^5.3.0',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/create-agentforge/src/__tests__/deps.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/create-agentforge/src/deps.ts packages/create-agentforge/src/__tests__/deps.test.ts
git commit -m "feat(create-agentforge): add dependency calculator"
```

---

## Chunk 2: Template Engine and File Generation

### Task 3: Handlebars Utils and Custom Helpers

**Files:**
- Create: `packages/create-agentforge/src/utils.ts`
- Test: `packages/create-agentforge/src/__tests__/utils.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/utils.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate, registerHelpers, toPascalCase, toCamelCase, toKebabCase } from '../utils.js';

describe('utils', () => {
  describe('toPascalCase', () => {
    it('converts kebab to PascalCase', () => expect(toPascalCase('my-agent')).toBe('MyAgent'));
    it('converts snake to PascalCase', () => expect(toPascalCase('my_agent')).toBe('MyAgent'));
    it('handles single word', () => expect(toPascalCase('agent')).toBe('Agent'));
  });

  describe('toCamelCase', () => {
    it('converts kebab to camelCase', () => expect(toCamelCase('my-agent')).toBe('myAgent'));
    it('converts snake to camelCase', () => expect(toCamelCase('my_agent')).toBe('myAgent'));
  });

  describe('toKebabCase', () => {
    it('converts Pascal to kebab', () => expect(toKebabCase('MyAgent')).toBe('my-agent'));
    it('converts camel to kebab', () => expect(toKebabCase('myAgent')).toBe('my-agent'));
  });

  describe('renderTemplate', () => {
    it('renders simple template', () => {
      const result = renderTemplate('Hello {{name}}!', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('renders conditional block', () => {
      const template = '{{#if enabled}}YES{{else}}NO{{/if}}';
      expect(renderTemplate(template, { enabled: true })).toBe('YES');
      expect(renderTemplate(template, { enabled: false })).toBe('NO');
    });

    it('renders each block', () => {
      const template = '{{#each items}}{{this}}{{/each}}';
      expect(renderTemplate(template, { items: ['a', 'b'] })).toBe('ab');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement utils.ts**

```typescript
// src/utils.ts
import Handlebars from 'handlebars';
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

export function toPascalCase(str: string): string {
  return str.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
}

export function registerHelpers(): void {
  Handlebars.registerHelper('pascalCase', toPascalCase);
  Handlebars.registerHelper('camelCase', toCamelCase);
  Handlebars.registerHelper('kebabCase', toKebabCase);
  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('neq', (a, b) => a !== b);
  Handlebars.registerHelper('and', (...args) => args.slice(0, -1).every(Boolean));
  Handlebars.registerHelper('or', (...args) => args.slice(0, -1).some(Boolean));
}

export function renderTemplate(template: string, data: Record<string, unknown>): string {
  registerHelpers();
  const compiled = Handlebars.compile(template);
  return compiled(data);
}

export function renderTemplateFile(templatePath: string, data: Record<string, unknown>): string {
  const templateContent = readFileSync(templatePath, 'utf-8');
  return renderTemplate(templateContent, data);
}

export function createTempDir(prefix: string = 'agentforge-'): string {
  const tempPath = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempPath, { recursive: true });
  return tempPath;
}

export function atomicMove(tempDir: string, targetDir: string): void {
  try {
    renameSync(tempDir, targetDir);
  } catch {
    // Cross-device: copy then remove
    cpSync(tempDir, targetDir);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function cpSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = require('fs').readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) cpSync(srcPath, destPath);
    else require('fs').copyFileSync(srcPath, destPath);
  }
}

export function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add packages/create-agentforge/src/utils.ts packages/create-agentforge/src/__tests__/utils.test.ts
git commit -m "feat(create-agentforge): add template rendering and file utilities"
```

---

### Task 4: Core Generator

**Files:**
- Create: `packages/create-agentforge/src/generator.ts`
- Test: `packages/create-agentforge/src/__tests__/generator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/generator.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateProject } from '../generator.js';
import type { PromptsConfig } from '../config.js';
import { DEFAULT_CONFIG } from '../config.js';

describe('generator', () => {
  const tempRoot = join(process.cwd(), '.test-output');

  beforeEach(() => {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('generateProject', () => {
    it('creates base project structure with --default config', async () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'test-agent',
        agentName: 'test-agent',
        llm: 'openai',
      };
      const targetDir = join(tempRoot, 'test-agent');
      await generateProject(config, targetDir);

      // Base files always exist
      expect(existsSync(join(targetDir, 'agentforge.config.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'package.json'))).toBe(true);
      expect(existsSync(join(targetDir, 'tsconfig.json'))).toBe(true);
      expect(existsSync(join(targetDir, '.env.example'))).toBe(true);
      expect(existsSync(join(targetDir, '.gitignore'))).toBe(true));
      expect(existsSync(join(targetDir, 'src', 'index.ts'))).toBe(true);

      // LLM adapter always exists
      expect(existsSync(join(targetDir, 'src', 'llm', 'adapter.ts'))).toBe(true);

      // Modules NOT selected should NOT exist
      expect(existsSync(join(targetDir, 'src', 'checkpoint'))).toBe(false);
      expect(existsSync(join(targetDir, 'src', 'observability'))).toBe(false);
      expect(existsSync(join(targetDir, 'src', 'hitl'))).toBe(false);
    });

    it('creates checkpoint files when checkpoint enabled', async () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'test-agent',
        agentName: 'test-agent',
        llm: 'openai',
        checkpoint: true,
        checkpointStorage: 'sqlite',
      };
      const targetDir = join(tempRoot, 'test-agent');
      await generateProject(config, targetDir);

      expect(existsSync(join(targetDir, 'src', 'checkpoint', 'storage.ts'))).toBe(true);
    });

    it('creates observability files when enabled', async () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'test-agent',
        agentName: 'test-agent',
        llm: 'openai',
        observability: true,
      };
      const targetDir = join(tempRoot, 'test-agent');
      await generateProject(config, targetDir);

      expect(existsSync(join(targetDir, 'src', 'observability', 'logger.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'observability', 'tracer.ts'))).toBe(true);
      expect(existsSync(join(targetDir, 'src', 'observability', 'metrics.ts'))).toBe(true);
    });

    it('generates L2 index.ts for simple apiMode', async () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'test-agent',
        agentName: 'test-agent',
        llm: 'openai',
        apiMode: 'simple',
      };
      const targetDir = join(tempRoot, 'test-agent');
      await generateProject(config, targetDir);

      const content = readFileSync(join(targetDir, 'src', 'index.ts'), 'utf-8');
      expect(content).toContain('createAgent');
      expect(content).not.toContain('AgentContextBuilder');
    });

    it('generates L3 index.ts for advanced apiMode', async () => {
      const config: PromptsConfig = {
        ...DEFAULT_CONFIG,
        projectName: 'test-agent',
        agentName: 'test-agent',
        llm: 'openai',
        apiMode: 'advanced',
      };
      const targetDir = join(tempRoot, 'test-agent');
      await generateProject(config, targetDir);

      const content = readFileSync(join(targetDir, 'src', 'index.ts'), 'utf-8');
      expect(content).toContain('AgentContextBuilder');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement generator.ts**

This is the largest implementation file. It reads config, determines which modules to include, renders all templates, and writes files. The implementation should:

1. Create a temp directory
2. Render base template files (package.json.hbs, tsconfig.json.hbs, etc.)
3. Render LLM adapter based on config.llm
4. Conditionally render each enabled module's files
5. Determine which modules are enabled, render only those directories
6. Write agentforge.config.ts with correct imports and config
7. Atomically move temp dir to target dir

```typescript
// src/generator.ts — Pseudocode structure, full implementation would be ~200 lines
export async function generateProject(config: PromptsConfig, targetDir: string): Promise<void> {
  const tempDir = createTempDir();
  try {
    // 1. Render base files
    renderAndWrite(config, tempDir, 'base/package.json.hbs', 'package.json');
    renderAndWrite(config, tempDir, 'base/tsconfig.json.hbs', 'tsconfig.json');
    renderAndWrite(config, tempDir, 'base/.env.example.hbs', '.env.example');
    writeFile(join(tempDir, '.gitignore'), GITIGNORE_CONTENT);
    renderAndWrite(config, tempDir, 'base/README.md.hbs', 'README.md');

    // 2. Render entry point (L2 or L3)
    const indexTemplate = config.apiMode === 'simple' ? 'base/src/index.ts.simple.hbs' : 'base/src/index.ts.advanced.hbs';
    renderAndWrite(config, tempDir, indexTemplate, 'src/index.ts');
    writeFile(join(tempDir, 'src', 'types.ts'), renderTemplateFile(/* base types */));

    // 3. Render LLM adapter
    renderModule(config, tempDir, `llm-${config.llm}`, 'src/llm/adapter.ts');

    // 4. Conditionally render enabled modules
    if (config.tools) renderModule(config, tempDir, 'tools', 'src/tools/index.ts');
    if (config.checkpoint) renderModule(config, tempDir, 'checkpoint', 'src/checkpoint/storage.ts');
    if (config.observability) {
      renderModule(config, tempDir, 'observability/logger', 'src/observability/logger.ts');
      renderModule(config, tempDir, 'observability/tracer', 'src/observability/tracer.ts');
      renderModule(config, tempDir, 'observability/metrics', 'src/observability/metrics.ts');
    }
    // ... more modules

    // 5. Generate agentforge.config.ts
    const configContent = generateConfigFile(config);
    writeFile(join(tempDir, 'agentforge.config.ts'), configContent);

    // 6. Atomic move
    atomicMove(tempDir, targetDir);
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Create base templates**

Create all `.hbs` template files under `packages/create-agentforge/templates/`. Each template uses Handlebars conditionals based on the PromptsConfig fields.

- [ ] **Step 6: Run test again to verify full templates render**

- [ ] **Step 7: Commit**

```bash
git add packages/create-agentforge/src/generator.ts packages/create-agentforge/src/__tests__/generator.test.ts packages/create-agentforge/templates/
git commit -m "feat(create-agentforge): add generator with template rendering"
```

---

## Chunk 3: CLI Entry Point and Interactive Prompts

### Task 5: Interactive Prompts

**Files:**
- Create: `packages/create-agentforge/src/prompts.ts`
- Test: `packages/create-agentforge/src/__tests__/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Test that prompts.collect() returns a valid PromptsConfig given inquirer mock inputs. Test that --default skips all prompts. Test that partial CLI args pre-fill prompt defaults.

- [ ] **Step 2: Implement prompts.ts**

Use inquirer to implement the 10-step interactive flow defined in the spec. Each prompt respects CLI arg overrides.

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add packages/create-agentforge/src/prompts.ts packages/create-agentforge/src/__tests__/prompts.test.ts
git commit -m "feat(create-agentforge): add interactive prompts"
```

---

### Task 6: Commander Entry Point

**Files:**
- Create: `packages/create-agentforge/src/index.ts`
- Test: `packages/create-agentforge/src/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing test**

Test that CLI parses arguments correctly, merges with defaults, validates, and calls generator. Test error cases (invalid --llm, existing directory).

- [ ] **Step 2: Implement index.ts**

Entry point: Commander program definition → parse args → merge with defaults → if no --default, run prompts → validate → generate → post-install.

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add packages/create-agentforge/src/index.ts packages/create-agentforge/src/__tests__/index.test.ts
git commit -m "feat(create-agentforge): add CLI entry point with Commander"
```

---

## Chunk 4: Post-Install, Examples, and Package Setup

### Task 7: Post-Install Script

**Files:**
- Create: `packages/create-agentforge/src/post-install.ts`

- [ ] **Implement post-install.ts**

Functions: `initGit()`, `installDeps()`, `formatWithPrettier()`.

- [ ] **Write integration test**

Test that post-install runs git init, npm install (mocked), and creates initial commit.

- [ ] **Commit**

```bash
git add packages/create-agentforge/src/post-install.ts packages/create-agentforge/src/__tests__/post-install.test.ts
git commit -m "feat(create-agentforge): add post-install steps"
```

---

### Task 8: Example Templates

**Files:**
- Create: `packages/create-agentforge/examples/weather-agent/` (all files)
- Create: `packages/create-agentforge/examples/full-pipeline/` (all files)

- [ ] **Create weather-agent example**

Simple L2 agent: OpenAI + weather tool. Run `npx tsx src/index.ts` should work.

- [ ] **Create full-pipeline example**

Advanced L3 agent: All modules enabled. Run `npx tsx src/index.ts` should work.

- [ ] **Test both examples run**

- [ ] **Commit**

```bash
git add packages/create-agentforge/examples/
git commit -m "feat(create-agentforge): add weather-agent and full-pipeline examples"
```

---

### Task 9: Package Configuration and Integration

**Files:**
- Create: `packages/create-agentforge/package.json`
- Create: `packages/create-agentforge/tsconfig.json`
- Create: `packages/create-agentforge/vitest.config.ts`

- [ ] **Create package.json with bin entry, dependencies, scripts**

```json
{
  "name": "create-agentforge",
  "version": "0.1.0",
  "type": "module",
  "bin": { "create-agentforge": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "inquirer": "^10.0.0",
    "handlebars": "^4.7.8",
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Create tsconfig.json**

- [ ] **Create vitest.config.ts**

- [ ] **Run full build and test**

```bash
cd packages/create-agentforge && npm install && npm run build && npm test
```

- [ ] **Test end-to-end: `npx create-agentforge test-output --default`**

Verify: generated project has all expected files, `npm run dev` works.

- [ ] **Commit**

```bash
git add packages/create-agentforge/package.json packages/create-agentforge/tsconfig.json packages/create-agentforge/vitest.config.ts
git commit -m "feat(create-agentforge): add package configuration and build setup"
```

---

## Chunk 5: --dry-run, --template, and Polish

### Task 10: --dry-run Mode

**Files:**
- Modify: `packages/create-agentforge/src/index.ts`
- Modify: `packages/create-agentforge/src/generator.ts`

- [ ] **Add --dry-run flag to Commander options**

- [ ] **Modify generator to support dry-run**

In dry-run mode: render all templates into temp dir, log the file list to console, then delete temp dir WITHOUT moving to target.

- [ ] **Test dry-run outputs file list without creating target directory**

- [ ] **Commit**

```bash
git add packages/create-agentforge/src/index.ts packages/create-agentforge/src/generator.ts
git commit -m "feat(create-agentforge): add --dry-run and --skip-install flags"
```

---

### Task 11: --template Mode (Clone Example Projects)

**Files:**
- Modify: `packages/create-agentforge/src/index.ts`
- Create: `packages/create-agentforge/src/template-loader.ts`

- [ ] **Implement template loading**

When `--template weather-agent`, copy from `examples/weather-agent/` directory. When `--template full-pipeline`, copy from `examples/full-pipeline/`. Adjust `agentforge.config.ts` with user's LLM choice and API key.

- [ ] **Test template mode creates runnable project**

- [ ] **Commit**

```bash
git add packages/create-agentforge/src/template-loader.ts packages/create-agentforge/src/index.ts
git commit -m "feat(create-agentforge): add --template mode for example projects"
```

---

### Task 12: Final Integration Test and README

**Files:**
- Create: `packages/create-agentforge/README.md`
- Create: `packages/create-agentforge/src/__tests__/integration.test.ts`

- [ ] **Write integration test**

Test full end-to-end: `create-agentforge my-test --default` → verify all files exist → `cd my-test && npm run build` succeeds.

- [ ] **Write README.md**

Usage documentation with all CLI options, examples, and module descriptions.

- [ ] **Run full test suite**

```bash
cd packages/create-agentforge && npm test
```

- [ ] **Commit**

```bash
git add packages/create-agentforge/README.md packages/create-agentforge/src/__tests__/integration.test.ts
git commit -m "feat(create-agentforge): add integration tests and README"
```