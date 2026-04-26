# 发布就绪性 — 设计文档

> 状态：待评审
> 阻塞等级：P0 — 没有 exports map 意味着 ESM 用户无法导入，没有 prepublishOnly 可能发布未编译代码
> 预估工作量：0.5 天

---

## 1. 问题

### 1.1 API 导出不完整

`src/index.ts` 不导出以下已实现模块的公共 API：

| 模块 | 缺失导出 | 影响 |
|------|---------|------|
| `src/quota/` | `QuotaController`, `QuotaUsage`, `QuotaLimits`, `MemoryQuotaController` | 用户无法 `import { MemoryQuotaController } from 'agentforge'` |
| `src/memory/` | `CompactionManager`, `CompactionResult`, `compaction strategies` | 用户无法导入自动压缩功能 |
| `src/observability/` | `ResourceMonitor`, `ResourceMetrics` | 用户无法监控资源 |
| `src/adapters/` | `OpenAIAdapter`, `AnthropicAdapter`, `createOpenAIAdapter`, `createAnthropicAdapter` | 用户无法从头创建 LLM adapter |

子模块导出（deep imports）也缺失：
- `agentforge/quota` — 无独立入口
- `agentforge/memory` — 无独立入口
- `agentforge/observability` — 无独立入口

### 1.2 package.json 发布配置缺失

| 缺失项 | 影响 |
|--------|------|
| `exports` map | ESM 用户 `Cannot find module` 错误 |
| `prepublishOnly` | 可能发布未编译的 TypeScript 源码 |
| `files` 字段不完整 | 可能包含不必要的文件 |
| 版本号 `0.1.0` | 1.0 发布前需要更新 |
| 无 `sideEffects` 声明 | tree-shaking 无法优化 |
| 无 `engines` 字段 | Node.js 版本要求未声明 |

---

## 2. API 导出补全

### 2.1 主入口 `src/index.ts` 补充

```typescript
// ============================================================
// Quota Management
// ============================================================

export {
  type QuotaUsage,
  type QuotaLimits,
  type QuotaController,
  MemoryQuotaController,
} from './quota/index.js';

// ============================================================
// Memory / Compaction
// ============================================================

export {
  type CompactionResult,
  type CompactionStrategy,
  type CompactionOptions,
  CompactionManager,
  // Strategies
  truncateStrategy,
  summarizeStrategy,
} from './memory/index.js';

// ============================================================
// Observability / Resource Monitoring
// ============================================================

export {
  type ResourceMetrics,
  type ResourceMonitorOptions,
  ResourceMonitor,
} from './observability/index.js';

// ============================================================
// LLM Adapters (Updated - New Adapter System)
// ============================================================

export {
  // Core adapter system
  ProviderRegistry,
  createHttpAdapter,
  createLLMAdapterFromSpec,
  
  // Error classification
  classifyError,
  type ClassifiedError,
  type ErrorCategory,
  
  // Retry policy
  calculateRetryDelay,
  type RetryConfig,
  
  // Legacy adapters (AI SDK based)
  OpenAIAdapter,
  createOpenAIAdapter,
  AnthropicAdapter,
  createAnthropicAdapter,
  
  // HTTP adapter (v1 compatible)
  createOpenAIHttpAdapter,
} from './adapters/index.js';
```

### 2.2 子模块独立入口

所有子模块入口文件已存在确认：

| 入口 | 文件 | 状态 |
|------|------|------|
| `src/quota/index.ts` | `QuotaController`, `MemoryQuotaController` 等 | ✅ 已存在 |
| `src/memory/index.ts` | `CompactionManager`, 策略函数等 | ✅ 已存在 |
| `src/observability/index.ts` | `ResourceMonitor`, `ResourceMetrics` | ✅ 已存在 |
| `src/adapters/index.ts` | `OpenAIAdapter`, `AnthropicAdapter`, `LLMAdapterFactory` 等 | ✅ 已存在 |
| `src/subagent/index.ts` | `SubagentRegistry`, `createSubagentRegistry` 等 | ✅ 已存在 |
| `src/workflow/index.ts` | `Workflow`, `WorkflowExecutor`, Pipeline 类等 | ✅ 已存在 |

---

## 3. package.json 发布配置

### 3.1 完整配置

```json
{
  "name": "agentforge",
  "version": "1.0.0",
  "description": "Agent framework based on RxJS event stream + Zod type safety",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./quota": {
      "types": "./dist/quota/index.d.ts",
      "import": "./dist/quota/index.js"
    },
    "./memory": {
      "types": "./dist/memory/index.d.ts",
      "import": "./dist/memory/index.js"
    },
    "./observability": {
      "types": "./dist/observability/index.d.ts",
      "import": "./dist/observability/index.js"
    },
    "./adapters": {
      "types": "./dist/adapters/index.d.ts",
      "import": "./dist/adapters/index.js"
    },
    "./plugins": {
      "types": "./dist/plugins/index.d.ts",
      "import": "./dist/plugins/index.js"
    },
    "./skill": {
      "types": "./dist/skill/index.d.ts",
      "import": "./dist/skill/index.js"
    },
    "./a2a": {
      "types": "./dist/a2a/index.d.ts",
      "import": "./dist/a2a/index.js"
    },
    "./mcp": {
      "types": "./dist/mcp/index.d.ts",
      "import": "./dist/mcp/index.js"
    },
    "./subagent": {
      "types": "./dist/subagent/index.d.ts",
      "import": "./dist/subagent/index.js"
    },
    "./workflow": {
      "types": "./dist/workflow/index.d.ts",
      "import": "./dist/workflow/index.js"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "sideEffects": false,
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "vitest run tests/e2e --reporter=verbose",
    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix",
    "format": "prettier --write \"src/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\"",
    "clean": "rimraf dist",
    "prepublishOnly": "npm run build",
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs",
    "docs:preview": "vitepress preview docs",
    "prepare": "husky"
  },
  "keywords": [
    "agent",
    "llm",
    "rxjs",
    "zod",
    "ai",
    "framework"
  ],
  "author": "",
  "license": "MIT",
  "dependencies": { ... },
  "devDependencies": { ... }
}
```

### 3.2 关键变更说明

| 字段 | 变更 | 原因 |
|------|------|------|
| `version` | `0.1.0` → `1.0.0` | 1.0 发布 |
| `exports` | 新增 | ESM 用户需要，deep import 支持 |
| `sideEffects` | 新增 `false` | tree-shaking 优化 |
| `prepublishOnly` | 新增 | 防止发布未编译代码 |
| `files` | 保留 `dist` + `README.md` + `LICENSE` | 只发布编译产物 |

---

## 5. 评审修复

### 5.1 `./subagent` 和 `./workflow` 入口验证

**已确认**：两个模块的入口文件已存在：
- `src/subagent/index.ts` ✅ — 导出 `SubagentConfig`, `SubagentResult`, `SubagentEntry`, `SubagentRegistry`, `createSubagentRegistry`
- `src/workflow/index.ts` ✅ — 导出 `Workflow`, `WorkflowExecutor`, `SequentialPipeline`, `ParallelPipeline` 等完整公共 API

`exports` map 中的 `"./subagent"` 和 `"./workflow"` 入口可以保留。

### 5.2 `sideEffects: false` 验证

**需验证项**：在变更清单中增加验证步骤。

`sideEffects: false` 声明该包所有模块都是纯函数、无副作用。经审查：

- `src/adapters/index.ts` 中有 `LLMAdapterFactoryImpl` 的懒初始化（`require('./openai.js')`），但这是条件性的工厂注册，不产生可见副作用
- `src/core/context.ts` 中有 `SimpleSchemaRegistry` 等默认实例创建，但都是在函数内部，不在顶层
- 其余模块均为纯导出

**结论**：`sideEffects: false` 声明安全。但建议在 CI 中增加 tree-shaking 验证步骤。

### 5.3 `peerDependencies` 声明

**修复**：在 `package.json` 中增加 `peerDependencies`：

```json
"peerDependencies": {
  "rxjs": "^7.0.0",
  "zod": "^3.23.0"
}
```

注意：`rx` 和 `zod` 当前在 `dependencies` 中（不是 `peerDependencies`）。对于框架类库，有两种策略：

1. **放在 `dependencies`（当前）**：用户无需单独安装，但可能有版本冲突
2. **放在 `peerDependencies`（建议改为）**：用户自行安装，避免版本冲突，但增加安装步骤

**推荐**：保持 `dependencies` 不变，但额外声明 `peerDependencies` 以支持用户已有安装的场景。npm 7+ 会自动安装 peer 依赖，不会增加安装步骤。重复声明不会导致问题。

### 5.4 `prepublishOnly` 增加 `clean` 步骤

**修复**：改为 `"prepublishOnly": "npm run clean && npm run build"`，确保每次发布前清理旧的 `dist/` 避免残留文件。

### 5.5 更新后的完整变更清单

| 文件 | 变更 |
|------|------|
| `src/index.ts` | 补充 quota/memory/observability/adapters 导出 |
| `src/observability/index.ts` | ✅ 已存在，确认导出完整 |
| `src/adapters/index.ts` | ✅ 已存在，确认导出完整 |
| `src/memory/index.ts` | ✅ 已存在，确认导出完整 |
| `src/quota/index.ts` | ✅ 已存在，确认导出完整 |
| `package.json` | 版本 → 1.0.0，添加 `exports`/`sideEffects`/`prepublishOnly`/`peerDependencies` |
| `tsconfig.json` | 确认 `declaration: true` 和 `declarationMap: true` |
| `tsconfig.json` | 确认 `declaration: true` 和 `declarationMap: true` |

---

## 6. 验证清单

| 验证项 | 方法 |
|--------|------|
| ESM 主入口导入 | `node --input-type=module -e "import { createAgentLoop } from 'agentforge';"` |
| ESM 子模块导入 | `node --input-type=module -e "import { MemoryQuotaController } from 'agentforge/quota';"` |
| 子模块入口完整性 | `import { Workflow } from 'agentforge/workflow'` 等全部子模块可解析 |
| 类型导出 | `tsc --noEmit` 无错误 |
| 发布内容 | `npm pack --dry-run` 只包含 `dist/` + `README.md` + `LICENSE` |
| prepublishOnly | `npm publish --dry-run` 触发 `npm run clean && npm run build` |
| tree-shaking | import `{ createAgentLoop }` 后 bundle 中不包含未使用的 `QuotaController`、`ResourceMonitor` |
| peerDependencies | `rxjs` 和 `zod` 正确解析 |