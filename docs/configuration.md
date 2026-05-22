# Configuration

AgentForge uses a multi-layer JSONC configuration system. Configuration is merged from four sources with clear priority ordering.

## Configuration Layers

Priority from highest to lowest:

| Priority | Source | Location | Use Case |
|----------|--------|----------|----------|
| 1 | Session-level | Runtime params to `agent.run()` | Per-request overrides |
| 2 | Project-level | `.agentforge/config.jsonc` | Project-specific settings |
| 3 | Global-level | `~/.agentforge/config.jsonc` | User-wide defaults |
| 4 | Environment | `AGENTFORGE_CONFIG` env var | Container/deployment overrides |

## Configuration Schema

```typescript
interface HarnessConfig {
  // Agent definitions
  agents?: Record<string, Partial<AgentConfig>>;

  // Tool access control
  tools?: { enabled?: string[]; disabled?: string[] };

  // Plugin activation
  plugins?: string[];

  // Session storage
  session?: { storage?: 'file' | 'memory'; path?: string };

  // Per-model behavior customization
  modelProfiles?: ModelProfile[];

  // Custom model gateways
  modelGateways?: GatewayConfig[];

  // Hook configuration
  hooks?: { profile?: HookProfile; disabledHooks?: string[] };

  // Harness processor configurations
  costCap?: {
    maxCost: number;
    strategy: 'block' | 'warn';
    modelPricing?: Record<string, { input: number; output: number }>;
  };
  tokenBudget?: {
    maxContextTokens: number;
    reservedOutputTokens: number;
    strategy: 'compress' | 'truncate' | 'block';
  };
  goalEcho?: {
    enabled: boolean;
    echoFrequency: number;
    progressTracking: boolean;
  };
  factInjection?: {
    facts: string[] | ((ctx) => string[] | Promise<string[]>);
  };
}
```

## Merge Strategy

- **Scalar values**: Higher priority layer wins
- **`plugins` and `modelGateways` arrays**: Concatenated across all layers
- **All other arrays**: Overridden by higher priority layer
- **Objects**: Deep merged recursively

## Example Configuration

```jsonc
// .agentforge/config.jsonc
{
  // Define agents accessible via the server
  "agents": {
    "assistant": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "You are a helpful assistant.",
      "maxIterations": 5
    },
    "coder": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "You are an expert programmer.",
      "maxIterations": 10,
      "profile": "coding"
    }
  },

  // Custom model endpoints
  "modelGateways": [
    {
      "name": "my-llm",
      "url": "https://api.example.com/v1",
      "apiKey": "sk-xxx"  // or use MY_LLM_API_KEY env var
    }
  ],

  // Model profiles for per-model customization
  "modelProfiles": [
    {
      "modelPattern": "deepseek",
      "systemPromptSuffix": "Please answer concisely."
    }
  ],

  // Session persistence
  "session": {
    "storage": "file",      // 'file' | 'sqlite' | 'memory'
    "path": "./sessions"    // directory for file mode, .db path for sqlite
  },

  // Cost control
  "costCap": {
    "maxCost": 1.0,
    "strategy": "warn",
    "modelPricing": {
      "deepseek/deepseek-v4-flash": { "input": 0.00014, "output": 0.00028 }
    }
  }
}
```

## Dynamic Configuration

Agent configuration fields support `Dynamic<T>` -- a value that is either static or resolved per-request:

```typescript
import { Agent } from '@primo-ai/core';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',

  // Static value
  systemPrompt: 'You are a helpful assistant.',

  // Dynamic value resolved per-request
  maxIterations: (ctx) => {
    // Use more iterations for complex requests
    return ctx.input.length > 500 ? 10 : 3;
  },
});
```

The `ResolveContext` passed to dynamic functions contains:
- `input` -- the user's input message
- `sessionId` -- the unique session identifier
- `metadata` -- additional request metadata

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENTFORGE_CONFIG` | Inline JSON configuration (lowest priority) |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key |
| `AGENTFORGE_API_KEY` | Server authentication key |
| `AGENTFORGE_PORT` | Server port (default: 3000) |

Custom gateway API keys follow the pattern: `{NAME}_API_KEY` where `NAME` is the gateway name in uppercase.

## Config Environment Variable Expansion

配置文件中的字符串值支持 `${VAR_NAME}` 和 `${VAR_NAME:-default}` 语法展开：

```jsonc
{
  "agents": {
    "assistant": {
      "model": "${MODEL_NAME:-deepseek/deepseek-v4-flash}",
      "systemPrompt": "Running in ${ENV:-development} mode"
    }
  }
}
```

- `${VAR}` — 展开为环境变量值，未设置时抛出 `ConfigEnvVarError`
- `${VAR:-default}` — 展开为环境变量值，未设置时使用默认值
- `1809` — 转义为字面量 `# Configuration

AgentForge uses a multi-layer JSONC configuration system. Configuration is merged from four sources with clear priority ordering.

## Configuration Layers

Priority from highest to lowest:

| Priority | Source | Location | Use Case |
|----------|--------|----------|----------|
| 1 | Session-level | Runtime params to `agent.run()` | Per-request overrides |
| 2 | Project-level | `.agentforge/config.jsonc` | Project-specific settings |
| 3 | Global-level | `~/.agentforge/config.jsonc` | User-wide defaults |
| 4 | Environment | `AGENTFORGE_CONFIG` env var | Container/deployment overrides |

## Configuration Schema

```typescript
interface HarnessConfig {
  // Agent definitions
  agents?: Record<string, Partial<AgentConfig>>;

  // Tool access control
  tools?: { enabled?: string[]; disabled?: string[] };

  // Plugin activation
  plugins?: string[];

  // Session storage
  session?: { storage?: 'file' | 'memory'; path?: string };

  // Per-model behavior customization
  modelProfiles?: ModelProfile[];

  // Custom model gateways
  modelGateways?: GatewayConfig[];

  // Hook configuration
  hooks?: { profile?: HookProfile; disabledHooks?: string[] };

  // Harness processor configurations
  costCap?: {
    maxCost: number;
    strategy: 'block' | 'warn';
    modelPricing?: Record<string, { input: number; output: number }>;
  };
  tokenBudget?: {
    maxContextTokens: number;
    reservedOutputTokens: number;
    strategy: 'compress' | 'truncate' | 'block';
  };
  goalEcho?: {
    enabled: boolean;
    echoFrequency: number;
    progressTracking: boolean;
  };
  factInjection?: {
    facts: string[] | ((ctx) => string[] | Promise<string[]>);
  };
}
```

## Merge Strategy

- **Scalar values**: Higher priority layer wins
- **`plugins` and `modelGateways` arrays**: Concatenated across all layers
- **All other arrays**: Overridden by higher priority layer
- **Objects**: Deep merged recursively

## Example Configuration

```jsonc
// .agentforge/config.jsonc
{
  // Define agents accessible via the server
  "agents": {
    "assistant": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "You are a helpful assistant.",
      "maxIterations": 5
    },
    "coder": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "You are an expert programmer.",
      "maxIterations": 10,
      "profile": "coding"
    }
  },

  // Custom model endpoints
  "modelGateways": [
    {
      "name": "my-llm",
      "url": "https://api.example.com/v1",
      "apiKey": "sk-xxx"  // or use MY_LLM_API_KEY env var
    }
  ],

  // Model profiles for per-model customization
  "modelProfiles": [
    {
      "modelPattern": "deepseek",
      "systemPromptSuffix": "Please answer concisely."
    }
  ],

  // Session persistence
  "session": {
    "storage": "file",      // 'file' | 'sqlite' | 'memory'
    "path": "./sessions"    // directory for file mode, .db path for sqlite
  },

  // Cost control
  "costCap": {
    "maxCost": 1.0,
    "strategy": "warn",
    "modelPricing": {
      "deepseek/deepseek-v4-flash": { "input": 0.00014, "output": 0.00028 }
    }
  }
}
```

## Dynamic Configuration

Agent configuration fields support `Dynamic<T>` -- a value that is either static or resolved per-request:

```typescript
import { Agent } from '@primo-ai/core';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',

  // Static value
  systemPrompt: 'You are a helpful assistant.',

  // Dynamic value resolved per-request
  maxIterations: (ctx) => {
    // Use more iterations for complex requests
    return ctx.input.length > 500 ? 10 : 3;
  },
});
```

The `ResolveContext` passed to dynamic functions contains:
- `input` -- the user's input message
- `sessionId` -- the unique session identifier
- `metadata` -- additional request metadata

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENTFORGE_CONFIG` | Inline JSON configuration (lowest priority) |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key |
| `AGENTFORGE_API_KEY` | Server authentication key |
| `AGENTFORGE_PORT` | Server port (default: 3000) |

Custom gateway API keys follow the pattern: `{NAME}_API_KEY` where `NAME` is the gateway name in uppercase.

（不展开）

## OpenTelemetry Auto-Wiring

Agent 构造时会自动检测 OTel 环境变量。只需设置 `OTEL_EXPORTER_OTLP_ENDPOINT`，trace 自动导出到 OTLP 兼容后端（Jaeger、Grafana Tempo、Datadog 等），无需任何代码配置：

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 
OTEL_TRACES_SAMPLER=parentbased_traceidratio 
OTEL_TRACES_SAMPLER_ARG=0.1 
agentforge serve
```

通过 `AgentDependencies.otelSampler` 可在代码级覆盖采样策略：

```typescript
const agent = new Agent(config, {
  otelSampler: 'always_off',  // 或 { ratio: 0.25 }
});
```

## CLI Flags

| Flag | 说明 |
|------|------|
| `--port <number>` | 服务器端口（默认 3000，也可用 `AGENTFORGE_PORT` 环境变量） |
| `--api-key <string>` | API 密钥（启用 Bearer Token 认证，也可用 `AGENTFORGE_API_KEY`） |
| `--config <path>` | 配置文件路径（默认 `.agentforge/config.jsonc`） |
| `--studio` | 启用嵌入式可观测性 UI（`/studio/`）和 Studio API（`/api/studio/*`） |

### Studio 标志

```bash
agentforge serve --studio --port 3000
```

启用后：
- `/api/studio/traces` — Trace 查询 API
- `/api/studio/metrics` — Metrics 快照 API
- `/api/studio/sessions` — Session 查询 API
- `/api/studio/agents` — Agent 列表 API
- `/studio/` — 嵌入式 Vue 3 SPA（Dashboard / Traces / Sessions）

需要先构建前端资源：

```bash
cd packages/studio-ui && pnpm build
```

未构建时访问 `/studio/` 会返回提示信息。
