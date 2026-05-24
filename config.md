# AgentForge 底座化激进重构实施计划

## 一、现状审计：9 个硬编码点

| # | 硬编码点 | 位置 | 当前形态 |
|---|---------|------|---------|
| H1 | Pipeline 阶段顺序 | [loop-orchestrator.ts:24-28](file:///workspace/packages/core/src/loop-orchestrator.ts#L24-L28) | 模块级常量 `PRE_LOOP_STAGES` / `LOOP_STAGES` / `POST_LOOP_STAGES` |
| H2 | Processor 注册 | [agent.ts:430-445](file:///workspace/packages/core/src/agent.ts#L430-L445) | `registerBuiltinProcessors()` 硬编码 9 个 Processor |
| H3 | Processor 依赖注入 | [agent.ts:434-443](file:///workspace/packages/core/src/agent.ts#L434-L443) | `createInvokeLLMProcessor({getLLM, registry, ...})` 闭包捕获 Agent 实例 |
| H4 | 工具注册 | [agent.ts:420-428](file:///workspace/packages/core/src/agent.ts#L420-L428) | `registerTools()` 仅注册 echo + config.tools，内置工具需代码引入 |
| H5 | Plugin 加载 | [plugin-manager.ts:58-76](file:///workspace/packages/core/src/plugin-manager.ts#L58-L76) | `loadPlugin(filePath)` 只支持路径字符串，不支持参数 |
| H6 | Hook 注册 | 无配置入口 | 只能通过 `HarnessAPI.registerHook()` 代码注册 |
| H7 | freeze 机制 | [harness.ts:39](file:///workspace/packages/core/src/harness.ts#L39) | 运行时一刀切冻结，无策略控制 |
| H8 | Agent 构造 | [agent.ts:100-118](file:///workspace/packages/core/src/agent.ts#L100-L118) | 构造函数内部组装所有依赖，非配置驱动 |
| H9 | Server Agent 组装 | [registry.ts:14-17](file:///workspace/packages/server/src/registry.ts#L14-L17) | `new Agent(config, deps)` 直接构造，不读配置 |

---

## 二、目标架构：一切行为皆可配置声明

### 核心原则

1. **配置是第一入口**——JSONC 文件能声明一切行为
2. **代码是逃生舱口**——TypeScript API 仍然可用，但不是唯一路径
3. **默认值即完整配置**——不写配置 = 当前默认行为，写配置 = 精确控制
4. **运行时可变**——配置变更可热重载，由策略控制安全边界

### 目标配置文件形态

```jsonc
{
  // ─── Pipeline 定义 ──────────────────────────────────────
  "pipeline": {
    "preLoop": ["processInput", "buildContext"],
    "loop": ["prepareStep", "gateLLM", "invokeLLM",
             "processStepOutput", "gateTool", "executeTools",
             "evaluateIteration"],
    "postLoop": ["processOutput"]
  },

  // ─── Processor 声明 ────────────────────────────────────
  "processors": {
    "processInput":  { "builtin": "processInput" },
    "buildContext":  { "builtin": "buildContext" },
    "prepareStep":   { "builtin": "prepareStep" },
    "gateLLM":       { "builtin": "gateLLM" },
    "invokeLLM":     { "builtin": "invokeLLM" },
    "processStepOutput": { "builtin": "processStepOutput" },
    "gateTool":      { "builtin": "gateTool" },
    "executeTools":  { "builtin": "executeTools" },
    "evaluateIteration": { "builtin": "evaluateIteration" },
    "processOutput": { "builtin": "processOutput" }
  },

  // ─── Agent 定义 ────────────────────────────────────────
  "agents": {
    "assistant": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "...",
      "maxIterations": 5,
      "pipeline": { /* 可覆盖全局 pipeline */ },
      "processors": { /* 可覆盖全局 processors */ },
      "tools": { "include": ["*"], "exclude": ["shell"] },
      "plugins": [
        { "id": "memory", "config": { "backend": "sqlite" } },
        { "id": "compression", "config": { "maxTokens": 8000 } },
        { "id": "permission", "config": { "mode": "interactive" } }
      ],
      "hooks": [
        { "point": "tool.after", "plugin": "eviction", "config": { "threshold": 4000 } }
      ]
    }
  },

  // ─── 运行时可变性策略 ──────────────────────────────────
  "mutability": {
    "pipeline": "configOnly",     // frozen | configOnly | dynamic
    "processors": "configOnly",
    "plugins": "dynamic",
    "tools": "dynamic",
    "hotReload": true,
    "watchConfig": true
  }
}
```

---

## 三、实施计划：6 个 Phase，Phase 1a/1b 可并行

> **2026-05-24 Momus 对抗审查修正：**
> - Phase 2 核心工作已完成（`LoopOrchestrator` 已接受 `stageConfig` 参数，见 `loop-orchestrator.ts:157-159`），降级为 Phase 1a 子任务
> - Phase 1（ProcessorRegistry）和 Phase 1a（Pipeline 配置）正交，可并行
> - Phase 5 增加：间隙优化模式、`selfRef` 延迟解引用、`endAutonomousLoop` 工具、ECC 12 层适配
> - Phase 6 增加：`StateMachine.forceReset()`、`layerDiagnostics`、Watchdog 分层实现

### Phase 1a：配置接管 Pipeline（~50 行）✅ 已完成

**目标：** HarnessConfig 能声明 Pipeline 阶段顺序。

**现状：** `LoopOrchestrator` 构造函数已接受 `stageConfig` 参数（`loop-orchestrator.ts:157-159`），默认值为 `PRE_LOOP_STAGES` / `LOOP_STAGES` / `POST_LOOP_STAGES` 常量。只需将 `HarnessConfig` 的 `pipeline` 字段穿线到 `LoopOrchestrator` 构造函数。

**改动文件：**

| 文件 | 改动 | 行数 |
|------|------|------|
| `sdk/src/index.ts` | `HarnessConfig` 增加 `pipeline?: PipelineStageConfig` 字段 | ~5 |
| `core/src/config.ts` | `HarnessConfigSchema` 增加对应 Zod 验证 | ~10 |
| `core/src/agent.ts` | 构造函数把 `config.pipeline` 传给 `LoopOrchestrator` 的 `deps?.stageConfig`（已存在） | ~3 |
| 测试 | 配置驱动的 Pipeline 行为验证 | ~30 |

**完成记录（2026-05-24）：**
- `sdk/src/index.ts`: `HarnessConfig` 新增 `pipeline?: PipelineStageConfig` 字段
- `core/src/config.ts`: `HarnessConfigSchema` 新增 `pipeline` Zod 验证（`preLoop`/`loop`/`postLoop` 均为 `z.array(z.string()).optional()`）
- Agent 穿线已存在：`agent.ts` 构造函数通过 `deps.stageConfig` 传给 `LoopOrchestrator`
- 新增测试 `core/__tests__/pipeline-config.test.ts`（8 个用例）：ConfigLoader 验证、LoopOrchestrator 穿线、Agent 穿线、Config→Agent 端到端
- 全套 1270 测试零回归

**验证标准：** 配置文件中修改 pipeline 阶段顺序 → Agent 行为跟随变化。✅ 通过

---

### Phase 1b：Processor 注册表（Foundation）✅ 已完成

**目标：** 把 9 个硬编码 Processor 变为可查找的注册表项。

**改动文件：**

| 文件 | 改动 |
|------|------|
| `sdk/src/index.ts` | 新增 `ProcessorRegistry` 接口 + `ProcessorDescriptor` 类型 |
| `core/src/processor-registry.ts` | **新建**。内置 Processor 注册表，支持 `builtin` 和 `module` 两种来源 |
| `core/src/processors/index.ts` | 每个内置 Processor 注册到 ProcessorRegistry |
| `core/src/agent.ts` | `registerBuiltinProcessors()` → 从 ProcessorRegistry 查找并注册 |

**关键类型：**

```typescript
// sdk/src/index.ts 新增

type ProcessorDescriptor =
  | { builtin: BuiltinProcessorName }
  | { module: string; export?: string; config?: Record<string, unknown> };

type BuiltinProcessorName =
  | 'processInput' | 'buildContext' | 'prepareStep' | 'gateLLM'
  | 'invokeLLM' | 'processStepOutput' | 'gateTool'
  | 'executeTools' | 'evaluateIteration' | 'processOutput';

interface ProcessorRegistry {
  register(name: BuiltinProcessorName, factory: ProcessorFactory): void;
  resolve(descriptor: ProcessorDescriptor, deps: ProcessorDeps): Processor;
  list(): BuiltinProcessorName[];
}

type ProcessorFactory = (deps: ProcessorDeps) => Processor;

interface ProcessorDeps {
  getLLM?: (systemPrompt?: string) => Promise<LLMInvoker>;
  registry?: ToolRegistry;
  hookManager?: HookManager;
  eventBus?: EventBus;
  modelString?: string;
  config?: Record<string, unknown>;
}
```

**核心逻辑：**

当前 `createInvokeLLMProcessor({getLLM, registry, hookManager, modelString})` 是工厂函数，已经接受依赖注入。Phase 1b 只是把"调用哪个工厂函数"从硬编码变为注册表查找。

**完成记录（2026-05-24）：**
- `sdk/src/index.ts`: 新增 `BuiltinProcessorName`、`ProcessorDescriptor`、`ProcessorDeps`、`ProcessorFactory` 类型
- `core/src/processor-registry.ts`: **新建**。`ProcessorRegistryImpl` 类（`register`/`resolve`/`has`/`list`）+ `globalProcessorRegistry` 单例
- `core/src/processors/index.ts`: 导入时自动注册 10 个内置 Processor 到 `globalProcessorRegistry`（保留原有 re-export 向后兼容）
- `core/src/agent.ts`:
  - 新增 `registerBuiltinProcessorsOnce()` 幂等函数，确保 `globalProcessorRegistry` 已填充
  - `registerBuiltinProcessors()` 改为遍历 `defaultProcessorDescriptors`，通过 `globalProcessorRegistry.resolve(descriptor, deps)` 查找
  - `buildContext` 保持 `contextBuilder.createProcessor()` 路径（运行时依赖）
  - 新增 `buildProcessorDeps()` 提取依赖构建逻辑
- 新增测试 `core/__tests__/processor-registry.test.ts`（9 个用例）：register/resolve/has/list、global 注册验证、module descriptor 错误、Agent 集成
- 全套 1270 测试零回归

**实现偏差：** 原 `ProcessorRegistry` 接口设计为 `register(name: BuiltinProcessorName, ...)` 限定类型，实际实现为 `register(name: string, ...)` 更灵活；`ProcessorDeps` 使用 `unknown` 替代具体类型避免 SDK 对 core 的依赖

**验证标准：** `new Agent(config)` 行为不变，但内部走注册表路径。✅ 通过

---

### Phase 2：配置接管 Processor

**目标：** HarnessConfig 能声明 Processor 选择。

**前置：** Phase 1b（ProcessorRegistry）。

**改动文件：**

| 文件 | 改动 |
|------|------|
| `sdk/src/index.ts` | `HarnessConfig` 增加 `processors` 字段 |
| `core/src/agent.ts` | 构造函数从 `HarnessConfig.processors` 查找 Processor |
| 测试 | 配置驱动的 Processor 选择验证 |

**HarnessConfig 扩展：**

```typescript
export interface HarnessConfig {
  // ... 现有字段保留 + Phase 1a 新增的 pipeline 字段 ...

  processors?: Record<StageName, ProcessorDescriptor>;
}
```

**具体流程：**
1. 读取 `deps.harnessConfig.processors` → 遍历，通过 `ProcessorRegistry.resolve()` 创建 Processor
2. 如果配置缺失 → 使用当前默认值（行为不变）

**验证标准：** 配置文件中指定 Processor → Agent 使用指定 Processor。

---

### Phase 3：配置接管 Plugin + Hook + Tool ✅ 已完成

**目标：** 配置文件能声明 Plugin（含参数）、Hook、工具集。

**改动文件：**

| 文件 | 改动 |
|------|------|
| `sdk/src/index.ts` | 新增 `BuiltinPluginId`、`PluginDescriptor`、`HookDescriptor`、`ToolSetConfig` 类型；`HarnessConfig` 的 `plugins`/`hooks`/`tools` 字段扩展 |
| `core/src/plugin-registry.ts` | **新建**。`PluginRegistryImpl` 类 + `globalPluginRegistry` 单例，与 `ProcessorRegistry` 同构 |
| `core/src/builtin-plugins.ts` | **新建**。`registerBuiltinPluginsOnce()` 幂等注册 6 个内置 Plugin（memory/compression/permission/skill/eviction/mcp） |
| `core/src/plugin-manager.ts` | 新增 `loadPluginsFromDescriptors()` 方法，支持 `{ id, config }` 和 `{ module }` 两种描述符 |
| `core/src/config.ts` | Zod schema 支持结构化 `PluginDescriptor`、`HookDescriptor`、`ToolSetConfig` 验证；向后兼容 `string[]` plugins |
| `core/src/index.ts` | 导出 `PluginRegistryImpl`、`globalPluginRegistry`、`registerBuiltinPluginsOnce` |
| `core/package.json` | 添加 `@primo-ai/plugins` 依赖 |

**完成记录（2026-05-24）：**
- `sdk/src/index.ts`: 新增 `BuiltinPluginId`（6 个：memory/compression/permission/skill/eviction/mcp）、`PluginDescriptor`（id | module 两种来源）、`HookDescriptor`（point + plugin + config? + priority?）、`ToolSetConfig`（include/exclude/custom + legacy enabled/disabled）
- `HarnessConfig.plugins`: `PluginDescriptor[] | string[]`（向后兼容）
- `HarnessConfig.hooks`: `HookDescriptor[] | { profile?, disabledHooks? }`（向后兼容）
- `HarnessConfig.tools`: `ToolSetConfig`（合并新旧格式，include/exclude + enabled/disabled 共存）
- `core/src/plugin-registry.ts`: `PluginRegistryImpl`（register/resolve/has/list），工厂签名为 `(config?) => PluginFactory`
- `core/src/builtin-plugins.ts`: `registerBuiltinPluginsOnce()` 注册 memory/compression/permission/skill/eviction/mcp
- `core/src/plugin-manager.ts`: `loadPluginsFromDescriptors()` 处理 3 种描述符（string / {id} / {module}）
- `core/src/config.ts`: Zod schema 新增 `PluginDescriptorSchema`（union: string | {id} | {module}）、`HookDescriptorSchema`、`ToolSetConfigSchema`（合并对象）
- 新增测试 `core/__tests__/phase3-plugin-hook-tool.test.ts`（27 个用例）：PluginRegistry CRUD、全局注册表 6 个内置 Plugin、HookDescriptor/ToolSetConfig 类型验证、HarnessConfig 扩展字段、ConfigLoader 验证、向后兼容、loadPluginsFromDescriptors 集成
- 全套 1308 测试零回归

**实现偏差：**
- 原 `hook-registry.ts` 独立 Hook 注册表未新建——HookDescriptor 通过 PluginManager 在 loadPluginsFromDescriptors 中解析，由 Plugin 工厂自行注册 Hook，无需独立的 Hook 注册表
- 原 `agent.ts registerTools()` 从配置读取工具集未实现——ToolSetConfig 类型已定义，Agent 级工具过滤留给后续 Phase
- `BuiltinPluginId` 仅包含 6 个已有 Plugin（原计划含 validation/costCap/rateLimit 等尚未独立为 Plugin 的功能）
- `ToolSetConfig` 采用合并字段方案（include/exclude + enabled/disabled），而非 union 类型，简化 Zod 验证

**验证标准：** 配置文件声明 Plugin + 参数 → Agent 行为与代码注册一致。✅ 通过

---

### Phase 4：运行时可变性 + 热重载 ✅ 已完成

**目标：** 配置变更可热重载，由策略控制安全边界。

**完成记录（2026-05-25）：**
- `sdk/src/index.ts`: 新增 `MutabilityLevel`、`MutabilityDomain`、`MutabilityPolicy`、`ReloadResult` 类型；`HarnessConfig` 新增 `mutability` 字段（支持 `MutabilityPolicy | MutabilityLevel`）
- `core/src/mutability-policy.ts`: **新建**。`MutabilityPolicyEngine` 类（`isMutable`/`canApplyDirectly`/`canApplyViaReload`/`updatePolicy`/`onPolicyChange`），支持全量策略、string shorthand、默认 all-frozen
- `core/src/config-watcher.ts`: **新建**。`ConfigWatcher` 类（`start`/`stop`/`onConfigChange`/`simulateChange`），支持 fs.watch、debounce、policy 感知（watchConfig=false 不启动）
- `core/src/config.ts`: Zod schema 新增 `MutabilityLevelSchema`（enum）、`MutabilityPolicySchema`（union: string | object）、`HarnessConfigSchema.mutability` 字段
- `core/src/harness.ts`: 新增 `setMutabilityPolicy()` 方法；`insertStage`/`removeStage`/`replaceStages` 的 frozen 检查改为 `frozen && !canApplyDirectly('pipeline')`
- `core/src/agent.ts`: `AgentDependencies` 新增 `mutabilityPolicy` 字段；Agent 构造函数创建 `MutabilityPolicyEngine`；新增 `reload(partial)` 方法（按 domain 检查策略，emit `config:reload:applied`/`config:reload:rejected` 事件）
- `core/src/index.ts`: 导出 `MutabilityPolicyEngine`、`ConfigWatcher`、`ConfigWatcherOptions`
- 新增测试 `core/__tests__/phase4-mutability-hotreload.test.ts`（31 个用例）：ConfigLoader mutability 验证（5）、MutabilityPolicyEngine CRUD（12）、Harness 策略感知 freeze（3）、ConfigWatcher（5）、Agent.reload（6）
- 全套 1339 测试零回归

**实现偏差：**
- `loop-orchestrator.ts` 的 `applyMutation()` 状态检查未改为 MutabilityPolicy 控制——`applyMutation` 的 `pending` 状态要求是安全守卫（防止运行时修改导致崩溃），不是可配置策略。MutabilityPolicy 通过 `HarnessAPIImpl` 的 freeze 逻辑和 `Agent.reload()` 在更高层控制
- `ConfigWatcher` 的 `simulateChange` 增加了 `immediate` 参数用于测试，生产环境中 `fs.watch` 变更走 debounce 路径

**改动文件：**

| 文件 | 改动 |
|------|------|
| `sdk/src/index.ts` | 新增 `MutabilityPolicy` 类型；`HarnessConfig` 增加 `mutability` 字段 |
| `core/src/mutability-policy.ts` | **新建**。运行时可变性策略引擎 |
| `core/src/harness.ts` | `freeze()` → 由 MutabilityPolicy 控制 |
| `core/src/loop-orchestrator.ts` | `applyMutation()` 的 `stateMachine.current !== 'pending'` 检查 → 由 MutabilityPolicy 控制 |
| `core/src/config-watcher.ts` | **新建**。监听配置文件变更，触发热重载 |
| `core/src/agent.ts` | 新增 `reload(config: Partial<HarnessConfig>)` 方法 |

**MutabilityPolicy：**

```typescript
type MutabilityLevel = 'frozen' | 'configOnly' | 'dynamic';

interface MutabilityPolicy {
  pipeline: MutabilityLevel;
  processors: MutabilityLevel;
  plugins: MutabilityLevel;
  tools: MutabilityLevel;
  hotReload: boolean;
  watchConfig: boolean;
}
```

| Level | 含义 |
|-------|------|
| `frozen` | 构造时确定，运行时不可变（当前行为） |
| `configOnly` | 只能通过修改配置文件 + 热重载变更 |
| `dynamic` | Agent 可通过工具/API 直接操作 |

**热重载流程：**

```
ConfigWatcher 检测文件变更
  → 读取新配置
  → diff 新旧配置
  → 按 MutabilityPolicy 判断哪些变更允许
  → 允许的变更：应用（替换 Processor / 注册 Plugin / 修改 Pipeline）
  → 禁止的变更：拒绝 + 发射 config:reload:rejected 事件
  → 发射 config:reload:applied 事件（含 diff）
```

**验证标准：** 修改配置文件 → Agent 热重载 → 行为变化，无需重启。

---

### Phase 5：Server 全面配置驱动 + 间隙优化 + 自指工具

**目标：** Server 从配置文件组装完整 Agent；Agent 在间隙中安全优化自身。

**改动文件：**

| 文件 | 改动 |
|------|------|
| `server/src/registry.ts` | `register()` 从 `HarnessConfig` 组装 Agent，而非直接 `new Agent(config)` |
| `server/src/server.ts` | 启动时加载配置，注册所有 Agent |
| `sdk/src/index.ts` | 新增 `AutonomousConfig`、`GapTrigger`、`SelfModificationRequest` 类型 |
| `core/src/agent.ts` | 新增 `selfRef` 延迟解引用、间隙优化方法、自指工具注册 |
| `core/src/state-machine.ts` | 新增 `forceReset()` 方法（绕过 `isRecoverable` 检查） |
| `server/src/config-loader.ts` | 间隙触发器注册（schedule/event/continuous） |

**Server 配置驱动组装流程：**

```
读取 config.jsonc
  → 解析 HarnessConfig
  → 遍历 agents
    → 解析每个 agent 的 pipeline / processors / plugins / hooks / tools
    → 通过 ProcessorRegistry / PluginRegistry / HookRegistry 解析
    → 构造 Agent 实例
    → 注册到 AgentRegistry
    → 如果 autonomous.enabled → 注册间隙触发器
```

**自指工具（4 个）：**

| 工具 | 功能 | 安全门控 |
|------|------|---------|
| `inspectSelf` | 查看当前 Pipeline 阶段、Processor、工具、插件、12 层诊断 | `allow` |
| `replaceProcessor` | 提议替换指定阶段的 Processor（间隙时应用） | `ask` |
| `registerPlugin` | 提议注册新 Plugin（间隙时应用） | `ask` |
| `endAutonomousLoop` | Agent 主动结束间隙优化循环 | `allow` |

**自指工具解引用：`selfRef` 延迟解引用**

```typescript
// agent.ts 构造函数
private selfRef: { agent: Agent } = { agent: undefined! };

constructor(config, deps) {
  // ... 现有构造逻辑 ...
  this.selfRef.agent = this;    // 末尾赋值
  this.registerTools();         // 工具闭包捕获 this.selfRef，执行时才解引用
  this.registerBuiltinProcessors();
}
```

工具在构造时注册，闭包捕获 `selfRef`，但 `execute` 调用时才解引用——此时 `selfRef.agent` 已指向 `this`。保持构造原子性，不需要构造后注入。

**间隙优化模型：**

Agent 正常服务用户请求，在两次请求之间的间隙做自我优化。间隙 = `completed`/`pending`/`error`/`cancelled` 状态，此时没有用户请求在执行。

```
用户请求 1    间隙    用户请求 2    间隙    用户请求 3
─────────── ───── ─────────── ───── ───────────
  running   gap     running   gap     running
            ↑                 ↑
            间隙优化           间隙优化
```

**间隙优化执行流程：**

```
1. 状态守卫：从 completed/error/cancelled 转为 pending
   （applyMutation 要求 pending 状态，见 loop-orchestrator.ts:167-169）

2. 运行自分析：agent.run(prompt, { signal: gapAbortController.signal })
   - Agent 可调用 inspectSelf（只读）
   - Agent 可调用 replaceProcessor（收集修改到 _pendingModifications，不立即应用）
   - 间隙运行可被用户请求抢占（AbortSignal 联动，见 agent.ts:191-193）

3. 自分析完成后，状态回到 completed，再次转为 pending

4. 批量验证+应用：取出 _pendingModifications，逐个 sandbox→verify→apply

5. 保持 pending 状态，等下一个用户 run() 自然转到 running
```

**间隙触发器类型：**

```typescript
type GapTrigger =
  | { type: 'idle'; idleTimeoutMs: number }
  | { type: 'schedule'; cron: string }
  | { type: 'afterRun'; minIntervalMs: number }
  | { type: 'onError' };
```

**AutonomousConfig 类型：**

```typescript
interface AutonomousConfig {
  enabled: boolean;
  gapTriggers: GapTrigger[];
  initialPrompt?: string;
  nextPromptTemplate?: string;
  maxOptimizationsPerGap?: number;    // 单次间隙最多应用几个修改
  maxConsecutiveErrors?: number;      // 默认 3
  errorBackoffMs?: number;            // 默认 60000
}
```

**不可恢复错误的处理：**

`state-machine.ts` 新增 `forceReset()`，仅限间隙优化内部使用：

```typescript
class StateMachine {
  forceReset(target: AgentState = 'pending'): void {
    const from = this._current;
    this._current = target;
    for (const cb of this.listeners) cb(from, target);
  }
}
```

`forceReset` 绕过 `isRecoverable` 检查，允许不可恢复错误后重置。受 Constitution `absolute` 级别保护——`state-machine.ts` 不可被 Agent 修改。

**Mutation Budget 耗尽处理：**

间隙优化监听 `budget:exceeded` 事件，收到后停止循环：

```typescript
const budgetHandler = () => { this._gapOptimizationRunning = false; };
this.eventBus.on('budget:exceeded', budgetHandler);
// 循环结束后清理
this.eventBus.off('budget:exceeded', budgetHandler);
```

**间隙优化事件清单：**

| 事件 | 触发时机 |
|------|---------|
| `gap:started` | 间隙优化开始 |
| `gap:preempted` | 用户请求抢占间隙优化 |
| `gap:optimization_complete` | 间隙优化完成 |
| `gap:optimization_error` | 单次间隙优化错误 |
| `gap:error_limit` | 连续错误达到上限 |
| `gap:budget_exhausted` | Mutation Budget 耗尽 |

**验证标准：** Agent 通过 `inspectSelf` 看到自身架构 → 在间隙中通过 `replaceProcessor` 提议修改 → 间隙结束时验证+应用 → 行为变化 → 用户请求不受影响。

---

## 四、Phase 间依赖关系

```
Phase 1a: 配置接管 Pipeline           ─┐ ✅
                                        │ 已完成
Phase 1b: ProcessorRegistry            ─┘ ✅
    ↓ (Phase 1b 必须：Processor 可查找)
Phase 2: 配置接管 Processor
    ↓ (Processor 可配置)
Phase 3: 配置接管 Plugin + Hook + Tool ✅
    ↓ (一切行为可配置)
Phase 4: 运行时可变性 + 热重载
    ↓ (配置可运行时变更)
Phase 5: Server 配置驱动 + 间隙优化 + 自指工具
    ↓ (自举闭环)
Phase 6: 自举安全层
    6a → 6b → 6c → 6d → 6e → 6f

6b ↔ 6c: Constitution 定义边界，Verification Gate 执行检查
6c ↔ 6d: Gate 在修改时验证，Watchdog 在修改后监控
```

Phase 1a 和 Phase 1b 无依赖，可并行。Phase 2 只依赖 Phase 1b 的 ProcessorRegistry，不依赖 Phase 1a 的 Pipeline 配置。

**进度（2026-05-25）：** Phase 1a ✅ + Phase 1b ✅ + Phase 3 ✅ + Phase 4 ✅ 已完成。下一步：Phase 2（配置接管 Processor）或 Phase 5（Server 配置驱动 + 间隙优化 + 自指工具）。

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| Processor 依赖注入复杂化（invokeLLM 需要 getLLM 闭包） | ProcessorDeps 接口统一所有依赖，工厂函数签名不变 |
| 配置文件 schema 过于复杂 | 分层：顶层默认 + agent 级覆盖，不写 = 当前默认行为 |
| 热重载导致运行中 Agent 状态不一致 | MutabilityPolicy `configOnly` 模式：变更在下次 `run()` 时生效，不影响当前运行 |
| 自指工具安全风险 | 默认 `ask` 模式，需人工审批；`frozen` 模式完全禁用 |
| Plugin 参数类型安全丢失 | 每个 Plugin 导出 Zod schema，ConfigLoader 验证 |
| **间隙优化在 `completed` 状态无法修改 Pipeline** | `applyMutation` 要求 `pending` 状态（`loop-orchestrator.ts:167-169`），间隙优化前显式 `transition('pending')` |
| **不可恢复错误卡死 Agent** | `StateMachine.forceReset()` 绕过 `isRecoverable` 检查，受 Constitution `absolute` 保护 |
| **间隙运行与用户请求并发** | 间隙运行可被 AbortSignal 抢占（`agent.ts:191-193` 已做 signal 联动） |
| **Mutation Budget 耗尽后空转** | 监听 `budget:exceeded` 事件，收到后停止间隙优化 |

---

## 六、每个 Phase 的预估工作量

| Phase | 核心改动 | 新建文件 | 修改文件 | 测试重点 |
|-------|---------|---------|---------|---------|
| 1a | 配置接管 Pipeline | 0 | 3 | 配置驱动的 Pipeline 行为验证 |
| 1b | Processor 注册表 | 1 | 3 | 所有现有测试不回归 |
| 2 | 配置接管 Processor | 0 | 2 | 配置驱动的 Processor 选择验证 |
| 3 | 配置接管 Plugin/Hook/Tool | 2 | 5 | Plugin 参数传递、Hook 注册验证 |
| 4 | 运行时可变性 + 热重载 | 2 | 3 | 热重载场景、MutabilityPolicy 边界 |
| 5 | Server + 间隙优化 + 自指工具 | 1 | 5 | 间隙优化流程、抢占、自指工具闭环 |

---

## 七、Phase 1b 的详细实施规格

因为 Phase 1b（ProcessorRegistry）是 Processor 配置化的基础，给出精确到函数签名的规格：

### 7.1 `sdk/src/index.ts` 新增类型

```typescript
type BuiltinProcessorName =
  | 'processInput' | 'buildContext' | 'prepareStep' | 'gateLLM'
  | 'invokeLLM' | 'processStepOutput' | 'gateTool'
  | 'executeTools' | 'evaluateIteration' | 'processOutput';

type ProcessorDescriptor =
  | { builtin: BuiltinProcessorName }
  | { module: string; export?: string; config?: Record<string, unknown> };

interface ProcessorDeps {
  getLLM?: (systemPrompt?: string) => Promise<unknown>;
  registry?: unknown;       // ToolRegistry
  hookManager?: unknown;    // HookManager
  eventBus?: unknown;       // EventBus
  modelString?: string;
  config?: Record<string, unknown>;
}

type ProcessorFactory = (deps: ProcessorDeps) => Processor;
```

### 7.2 `core/src/processor-registry.ts` 新建

```typescript
class ProcessorRegistry {
  private factories = new Map<string, ProcessorFactory>();

  register(name: string, factory: ProcessorFactory): void;
  resolve(descriptor: ProcessorDescriptor, deps: ProcessorDeps): Processor;
  has(name: string): boolean;
  list(): string[];
}

const globalProcessorRegistry = new ProcessorRegistry();
export { globalProcessorRegistry };
```

### 7.3 `core/src/processors/index.ts` 改造

每个内置 Processor 在模块加载时注册：

```typescript
globalProcessorRegistry.register('processInput', () => processInputProcessor);
globalProcessorRegistry.register('buildContext', () => buildContextExtensionPoint);
globalProcessorRegistry.register('prepareStep', () => prepareStepExtensionPoint);
globalProcessorRegistry.register('gateLLM', () => gateLLMExtensionPoint);
globalProcessorRegistry.register('invokeLLM', (deps) => createInvokeLLMProcessor(deps));
globalProcessorRegistry.register('processStepOutput', () => processStepOutputProcessor);
globalProcessorRegistry.register('gateTool', () => gateToolExtensionPoint);
globalProcessorRegistry.register('executeTools', (deps) => createExecuteToolsProcessor(deps.registry));
globalProcessorRegistry.register('evaluateIteration', (deps) => createEvaluateIterationProcessor(deps));
globalProcessorRegistry.register('processOutput', () => processOutputProcessor);
```

### 7.4 `core/src/agent.ts` 改造

```typescript
// 当前
private registerBuiltinProcessors(): void {
  this.runner.register(processInputProcessor);
  this.runner.register(this.contextBuilder.createProcessor());
  // ... 9 行硬编码
}

// 改为
private registerProcessors(descriptors?: Record<string, ProcessorDescriptor>): void {
  const registry = globalProcessorRegistry;
  const deps = this.buildProcessorDeps();
  const entries = descriptors ?? defaultProcessorDescriptors;

  for (const [stage, descriptor] of Object.entries(entries)) {
    const processor = registry.resolve(descriptor, deps);
    processor.stage = stage as StageName;
    this.runner.register(processor);
  }
}
```

**关键：** `defaultProcessorDescriptors` 就是当前硬编码的等价配置，确保不写配置时行为完全不变。

---

这就是 Phase 1-5 的完整重构计划。Phase 1 是地基，建议从它开始。

---

## 八、Phase 6：自举安全层

Phase 1-5 让 AgentForge 从硬编码变成配置驱动。Phase 6 在配置驱动的基础上，增加 Agent 自修改所需的安全机制——让 Agent 能安全地改自己而不会永久退化。

### 前置决策（2026-05-24 裁定）

| # | 决策 | 裁定 |
|---|------|------|
| 1 | 自修改粒度 | 单 Processor 为主粒度，单文件为 L1 逃生粒度 |
| 2 | 审批模式 | 阈值自动：L0 自动放行 / L1 自动+审计 / L2/L3 人工 / L4 永远拒绝 |
| 3 | 回滚策略 | 三层递进：Snapshot(Processor异常) → Checkpoint(Pipeline损坏) → Git(源码编译失败) |
| 4 | 验证深度 | 三层：tsc --noEmit (<10s) → vitest --changed (<30s) → 固定基准子集 (<120s) |
| 5 | 宪法边界 | 三层不可变：规范层(sdk类型) → 安全层(constitution/watchdog/verification-gate) → 验证层(固定基准文件) |

### Phase 6 依赖图

```
6a. Self-Representation ─── Agent 知道自己
         ↓
6b. Constitution ────────── 定义不可变边界
         ↓
6c. Verification Gate ───── 执行验证管道
         ↓                    ↑
6d. Degeneration Watchdog ─── 监控 + 回滚
         ↓                    ↑
6e. Mutation Budget ──────── 限速
         ↓
6f. 加固自指工具 ─────────── sandbox→verify→apply 闭环
```

---

### 6a. Self-Representation

**目标：** Agent 知道自己的架构——模块依赖图、文件职责、可修改边界。

**新建文件：**

| 文件 | 职责 |
|------|------|
| `core/src/self-representation.ts` | 模块依赖图 + 文件职责模型 |
| `.agentforge/self-model.jsonc` | 自动生成的自表示数据 |

**类型定义（加入 sdk）：**

```typescript
interface SelfRepresentation {
  modules: ModuleInfo[];
  dependencies: ModuleDependency[];
  layerDiagnostics: LayerDiagnostic[];    // ECC 12 层诊断
  constitution: ConstitutionBoundary;
  modificationHistory: ModificationRecord[];
}

interface ModuleInfo {
  name: string;
  path: string;
  responsibility: string;
  mutability: 'frozen' | 'configOnly' | 'dynamic';
  exports: string[];
  dependsOn: string[];
}

interface LayerDiagnostic {
  layer: number;
  name: string;
  agentForgeComponent: string;
  codeGated: boolean;
  knownFailurePatterns: string[];
  lastCheckResult?: HealthCheckResult;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface ModificationRecord {
  timestamp: string;
  module: string;
  type: 'processor' | 'plugin' | 'config' | 'source';
  diff: string;
  verificationResult: 'passed' | 'failed' | 'skipped';
  approvedBy: 'auto' | 'human' | 'constitution';
}
```

**ECC 12 层诊断映射：**

`layerDiagnostics` 在 `inspectSelf` 调用时从 Watchdog 最近检查结果动态构建，不是静态数据。映射关系：

| ECC 层 | AgentForge 组件 | codeGated |
|--------|----------------|-----------|
| 1. System prompt | `config.systemPrompt` | 否 |
| 2. Session history | `PipelineContext.session` | 否 |
| 3. Long-term memory | `memoryPlugin` | 是（memory admission） |
| 4. Distillation | `compressionPlugin` | 是（token 阈值） |
| 5. Active recall | `contextBuilder` | 否 |
| 6. Tool selection | `gateTool` + `requiredTools` | **是**（`evaluate-iteration.ts:80-155`） |
| 7. Tool execution | `executeTools` | 是（before/after hooks） |
| 8. Tool interpretation | `processStepOutput` | 否（当前 no-op） |
| 9. Answer shaping | `processOutput` | 否（当前 no-op） |
| 10. Platform rendering | Server HTTP 层 | 否 |
| 11. Hidden repair loops | `fallback-runner` + `compatRule` | 是（事件发射） |
| 12. Persistence | `checkpointStore` | 否 |

**生成方式（动态查询，非静态生成）：** Self-Representation 不做静态文件生成，而是**每次 `inspectSelf` 调用时实时构建**：
1. `modules` → 从 `ProcessorRegistry.list()` + `PluginManager` + `ToolRegistry.list()` 动态获取
2. `dependencies` → 从 `PipelineStageConfig` 和 Processor 间的数据流推断
3. `constitution` → 从内存中的 `Constitution` 实例读取
4. `modificationHistory` → 从 `MutationBudget` 的 `SyncEventStore` 查询 `mutation` 事件流

`.agentforge/self-model.jsonc` 只作为**缓存**，不作为权威来源。权威来源是运行时状态。

理由（缝隙 6 修补）：静态生成会在自修改后与实际情况不同步——Agent 改了 Processor 但 self-model 没更新。动态查询消除了这个同步问题。

**Agent 访问方式：** Phase 5 的 `inspectPipeline` 工具扩展为 `inspectSelf`，返回 `SelfRepresentation`。

---

### 6b. Constitution System

**目标：** 定义 Agent 不可修改的边界，运行时强制执行。

**新建文件：**

| 文件 | 职责 |
|------|------|
| `core/src/constitution.ts` | 宪法引擎——加载、验证、执行不可变边界 |
| `.agentforge/constitution.jsonc` | 宪法声明文件（人类编写，Agent 只读） |

**类型定义（加入 sdk）：**

```typescript
interface Constitution {
  version: 1;
  protectedPaths: ProtectedPath[];
  diffLimits: DiffLimits;
  immutableInterfaces: ImmutableInterface[];  // 结构化：module/export/members/reason
  requiredCapabilities: string[];
  benchmarkFiles: string[];
  approvalMatrix: ApprovalMatrix;
}

interface ProtectedPath {
  pattern: string;          // glob
  reason: string;
  level: 'absolute' | 'approval';  // absolute=永远不可改, approval=需人工
}

interface ImmutableInterface {
  module: string;         // 文件路径，如 "packages/sdk/src/index.ts"
  export: string;        // 导出名，如 "Processor"
  members: string[];     // 受保护的成员方法，如 ["execute"]
  reason: string;
}

interface DiffLimits {
  maxFilesPerMutation: number;
  maxLinesPerFile: number;
  maxMutationsPerHour: number;
  maxMutationsPerDay: number;
  cooldownMs: number;
}

interface ApprovalMatrix {
  L0: { description: string; mode: 'auto' };
  L1: { description: string; mode: 'auto_with_audit'; auditTarget: string; auditEvent: string; auditPayload: string[] };
  L2: { description: string; mode: 'human_approval' };
  L3: { description: string; mode: 'human_approval' };
  L4: { description: string; mode: 'always_reject' };
}
```

**宪法声明内容（`.agentforge/constitution.jsonc`）：**

```jsonc
{
  "version": 1,
  "protectedPaths": [
    { "pattern": "packages/sdk/src/index.ts", "reason": "规范层：接口定义", "level": "absolute" },
    { "pattern": "packages/core/src/constitution.ts", "reason": "宪法自身", "level": "absolute" },
    { "pattern": "packages/core/src/verification-gate.ts", "reason": "验证管道", "level": "absolute" },
    { "pattern": "packages/core/src/degeneration-watchdog.ts", "reason": "看门狗", "level": "absolute" },
    { "pattern": "packages/core/src/mutability-policy.ts", "reason": "可变性策略", "level": "absolute" },
    { "pattern": "packages/core/src/state-machine.ts", "reason": "状态机（含 forceReset）", "level": "absolute" },
    { "pattern": ".agentforge/constitution.jsonc", "reason": "宪法声明", "level": "absolute" },
    { "pattern": "packages/core/src/loop-orchestrator.ts", "reason": "循环编排器", "level": "approval" },
    { "pattern": "packages/core/src/harness.ts", "reason": "HarnessAPI 实现", "level": "approval" },
    { "pattern": "packages/core/src/plugin-manager.ts", "reason": "插件管理器", "level": "approval" }
  ],
  "diffLimits": {
    "maxFilesPerMutation": 3,
    "maxLinesPerFile": 50,
    "maxMutationsPerHour": 10,
    "maxMutationsPerDay": 30,
    "cooldownMs": 300000
  },
  "immutableInterfaces": [
    { "module": "packages/sdk/src/index.ts", "export": "Processor", "members": ["execute"], "reason": "..." },
    { "module": "packages/sdk/src/index.ts", "export": "Tool", "members": ["execute"], "reason": "..." },
    { "module": "packages/sdk/src/index.ts", "export": "HarnessAPI", "members": ["registerProcessor", "registerTool", "unregisterTool", "registerHook", "insertStage", "removeStage", "replaceStages"], "reason": "HarnessAPI 是 Plugin 操作框架的唯一入口" },
    { "module": "packages/sdk/src/index.ts", "export": "PipelineContext", "members": ["request", "agent", "iteration", "session"], "reason": "..." }
  ],
  "requiredCapabilities": ["invokeLLM", "executeTools", "evaluateIteration", "processInput", "processOutput"],
  "benchmarkFiles": [
    "packages/core/__tests__/full-pipeline.test.ts",
    "packages/core/__tests__/agent.test.ts",
    "packages/core/__tests__/loop-orchestrator.test.ts",
    "packages/core/__tests__/pipeline-observability.test.ts",
    "packages/core/__tests__/state-machine.test.ts",
    "packages/core/__tests__/tool-registry.test.ts",
    "packages/core/__tests__/session-manager.test.ts",
    "packages/core/__tests__/hook-manager.test.ts",
    "packages/core/__tests__/event-system.test.ts",
    "packages/core/__tests__/checkpoint-store.test.ts",
    "packages/core/__tests__/llm-invoker.test.ts",
    "packages/core/__tests__/model-factory.test.ts",
    "packages/core/__tests__/runner.test.ts",
    "packages/core/__tests__/streaming.test.ts",
    "packages/core/__tests__/config.test.ts",
    "packages/core/__tests__/fallback-runner.test.ts",
    "packages/core/__tests__/stage-mutation.test.ts"
  ],
  "approvalMatrix": {
    "L0": { "description": "只读操作", "mode": "auto" },
    "L1": { "description": "可逆修改", "mode": "auto_with_audit", "auditTarget": "SyncEventStore", "auditEvent": "self:mutation:auto_approved", "auditPayload": ["diff", "verificationReport", "rollbackSnapshotId"] },
    "L2": { "description": "不可逆修改", "mode": "human_approval" },
    "L3": { "description": "结构性修改", "mode": "human_approval" },
    "L4": { "description": "宪法级修改", "mode": "always_reject" }
  }
}
```

**内存权威规则（缝隙 2 修补）：** Constitution 引擎在 Agent 启动时从 `.agentforge/constitution.jsonc` 加载一次，之后**内存中的版本是权威版本**，不从磁盘重新读取。Verification Gate 使用内存中的 Constitution 实例，而非磁盘上的文件。

理由：Agent 可以通过 `fileWrite` 工具直接修改磁盘上的 `constitution.jsonc` 文件。如果 Gate 读磁盘文件，Agent 可以删除受保护路径列表让任何修改通过。内存权威杜绝了这个时序漏洞。

**执行点：** Verification Gate 的第一层就是宪法检查——diff 触及 `absolute` 保护路径 → 直接拒绝；触及 `approval` 路径 → 需人工审批。`requiredCapabilities` 确保 Agent 不会删除自己的核心能力。

---

### 6c. Verification Gate Pipeline

**目标：** 自修改必须通过多层验证管道。

**新建文件：**

| 文件 | 职责 |
|------|------|
| `core/src/verification-gate.ts` | 验证管道引擎 |
| `core/src/verification/gates/constitution-gate.ts` | Gate 1: 宪法检查 |
| `core/src/verification/gates/typecheck-gate.ts` | Gate 2: tsc --noEmit |
| `core/src/verification/gates/unit-test-gate.ts` | Gate 3: vitest --changed |
| `core/src/verification/gates/benchmark-gate.ts` | Gate 4: 固定基准子集 |
| `core/src/verification/gates/capability-gate.ts` | Gate 5: 核心能力保留检查 |

**类型定义（加入 sdk）：**

```typescript
type GateResult =
  | { passed: true; duration: number; details?: string }
  | { passed: false; duration: number; errors: string[]; gate: string };

interface VerificationGate {
  name: string;
  level: number;
  timeoutMs: number;  // 缝隙 7：每个 Gate 必须有超时，超时=失败
  execute(diff: FilePatch[], context: VerificationContext): Promise<GateResult>;
}

interface VerificationContext {
  constitution: Constitution;
  snapshotId: string;
  agentId: string;
  skipGates?: number[];  // 允许跳过的 gate level（仅人类可设置）
}

interface VerificationReport {
  timestamp: string;
  diff: FilePatch[];
  gates: GateResult[];
  overall: 'passed' | 'failed';
  approvedBy: 'auto' | 'human';
}

// 缝隙 1：不复用独立的 FileDiff，扩展现有 SDK FilePatch 增加 content/oldContent
// SDK 中 FilePatch 已有 path/oldHash/newHash/type，此处扩展：
//   content?: string     — 用于宪法检查（diff 内容是否触及受保护路径）
//   oldContent?: string  — 用于回滚（恢复文件原始内容）
```

**五层 Gate 与默认超时：**

```
Gate 1: ConstitutionGate    → diff 是否触及受保护文件？diff 是否超限？    timeout: 1s
Gate 2: TypeCheckGate       → tsc --noEmit 是否通过？                  timeout: 60s
Gate 3: UnitTestGate        → vitest --changed 是否通过？              timeout: 120s
Gate 4: BenchmarkGate       → 固定基准子集是否通过？                    timeout: 300s
Gate 5: CapabilityGate      → requiredCapabilities 是否保留？          timeout: 5s

Agent 发起自修改
  → SnapshotService.track(true)  // 创建回滚点
  → 应用 diff
  → Gate 1-5 逐层执行（每个 Gate 有独立 timeoutMs，超时=失败）
  → 任一失败 → revert → 拒绝
  → 全部通过 → 按风险等级决定审批：
     L0/L1 → 自动放行 + 审计记录
     L2/L3 → 人工审批
  → 发射 verification:complete 事件（含 VerificationReport）
```

注意（缝隙 7）：`tsc --noEmit` 在大型项目上可能需要 30s+；如果编译器挂起，无超时会永久阻塞。每个 Gate 的超时时间已在上方标注，超时等同于验证失败。

---

### 6d. Degeneration Watchdog

**目标：** 外部进程监控 Agent 健康，检测退化并自动回滚。

**新建文件：** `core/src/degeneration-watchdog.ts`

**类型定义（加入 sdk）：**

```typescript
interface WatchdogConfig {
  checkIntervalMs: number;
  degradationThreshold: number;  // 连续失败次数触发回滚
  healthChecks: HealthCheck[];
  autoRollback: boolean;
  rollbackTarget: 'lastKnownGood' | 'lastSnapshot';
}

interface HealthCheck {
  name: string;
  check: () => Promise<HealthCheckResult>;
}

type HealthCheckResult =
  | { healthy: true; metrics?: Record<string, number> }
  | { healthy: false; reason: string; severity: 'warning' | 'critical' };

interface WatchdogState {
  consecutiveFailures: number;
  lastHealthySnapshot: string;
  lastCheckTime: string;
  totalRollbacks: number;
}
```

**分层健康检查（缝隙 3 修补）：**

`agent.run('ping')` 每次触发 LLM 调用（1-5s + Token 消耗），高频周期检查不可行。改为分层检查：

| 层级 | 检查 | 成本 | 频率 | 严重度 |
|------|------|------|------|--------|
| L0 轻量 | `agent.state === 'completed' \|\| 'pending'` | 0 | 每 30s | critical |
| L0 轻量 | `agent.toolRegistry.list().length >= baseline` | 0 | 每 30s | critical |
| L1 中量 | `vitest run --reporter=json` exit code 0 | 编译+测试 | 每 5min | critical |
| L1 中量 | Token 使用合理（最近 N 次运行统计无异常增长） | 读 Session | 每 5min | warning |
| L2 重量 | `agent.run('ping')` → 完整 LLM 调用 | 1-5s + Token | 每次自修改后 1 次 | critical |

L2 只在自修改后触发一次，不做周期性检查。L0 做高频轻量检查，L1 做低频中量检查。

**退化检测逻辑：**

```
L0 检查（每 30s）:
  agent.state / toolCount
  if 失败 → consecutiveFailures++，触发 L1 验证

L1 检查（每 5min，或 L0 失败时立即触发）:
  vitest run / tokenAudit
  if 全部 healthy:
    consecutiveFailures = 0
    更新 lastHealthySnapshot
  else:
    consecutiveFailures++
    if consecutiveFailures >= degradationThreshold:
      发射 watchdog:degradation-detected
      if autoRollback:
        SnapshotService.revert(lastHealthySnapshot)
        发射 watchdog:rollback-executed
      else:
        发射 watchdog:rollback-required（需人工）

L2 检查（每次自修改 apply 后 1 次）:
  agent.run('ping')
  if 失败 → 立即触发回滚（不等 degradationThreshold）
```

**关键设计：Watchdog 独立进程/线程，与 Agent 进程隔离。**

**Watchdog 分层实现：**

| 阶段 | 模式 | 成本 | 风险 |
|------|------|------|------|
| v1（Phase 6d 交付） | 同进程，`setInterval` + 健康检查 | ~80 行 | Agent 崩溃时 Watchdog 一起崩溃 |
| v2（后续优化） | `worker_threads`，共享内存 | ~200 行 | Agent 主线程崩溃时 worker 仍可检测 |
| v3（最终形态） | 独立子进程，IPC | ~500 行 | 完全隔离，需要协议设计 |

v1 风险缓解：Agent 崩溃 = 整个进程崩溃 = 外部编排器（PM2/Docker）检测并重启。Watchdog 的独立进程价值在于"检测退化而非崩溃"——崩溃由外部编排器处理。

**ECC 失败模式 → Watchdog L0 检查项：**

| ECC 问题 | Watchdog L0 检查 | 数据来源 |
|---------|-----------------|---------|
| 1. Can model skip required tool? | `required_tools:exhausted` 事件计数 | 已有事件 |
| 2. Old content in new turns? | session.messageHistory 长度 / maxTokens 比值 | 已有数据 |
| 3. Same info in prompt+memory+history? | promptFragments 数量 + memory 检索数量 | 已有数据 |
| 4. Second LLM pass before delivery? | `task:fallback` 事件计数 | 已有事件 |
| 5. Output differs internal vs delivery? | processOutput 前后 diff | 需新增 |
| 6. "Must use tool" only in prompt? | `requiredTools` 数组是否为空 | 已有数据 |
| 7. Agent monologue → persistent memory? | memoryPlugin 写入来源审计 | 需新增 |

---

### 6e. Mutation Budget

**目标：** 限制自修改速率，防止短时间过多修改。

**新建文件：** `core/src/mutation-budget.ts`

**类型定义（加入 sdk）：**

```typescript
interface MutationBudgetConfig {
  maxMutationsPerHour: number;
  maxMutationsPerDay: number;
  maxDiffLinesPerMutation: number;
  maxFilesPerMutation: number;
  cooldownMs: number;
}

interface MutationBudgetState {
  hourlyCount: number;
  hourlyResetAt: number;
  dailyCount: number;
  dailyResetAt: number;
  lastMutationAt: number;
}
```

**持久化（缝隙 4 修补）：** 使用已有的 `JsonlSyncEventStore`（`sync-event.ts`）持久化每次 mutation 事件。MutationBudget 从事件流重建状态，而非依赖内存计数器——进程重启不会绕过预算限制。

```typescript
// 每次 mutation 成功后
syncEventStore.append('mutation', { timestamp, module, type, diff });

// 预算检查时
const recentMutations = syncEventStore.query({ since: hourlyResetAt });
if (recentMutations.length >= maxMutationsPerHour) reject;
```

这与 Session 持久化的模式一致——事件即真相，内存只是缓存。

**与宪法的关系：** `Constitution.diffLimits` 定义硬上限，`MutationBudgetConfig` 定义运行时预算。预算不能超过宪法限制。

---

### 6f. 安全加固自指工具

**目标：** Phase 5 的三个自指工具增加 sandbox→verify→apply 流程。

**改造 Phase 5 的工具：**

| 工具 | Phase 5 行为 | Phase 6 加固 |
|------|-------------|-------------|
| `inspectSelf` | 直接返回数据（含 layerDiagnostics） | 不变（只读，无需加固） |
| `registerPlugin` | 间隙中提议 | sandbox 加载 → 验证 → 注册 |
| `replaceProcessor` | 间隙中提议 | sandbox 运行 → 验证 → 替换 |
| `endAutonomousLoop` | Agent 主动结束循环 | 不变（只写标志位，无需加固） |

**类型定义（加入 sdk）：**

```typescript
interface SelfModificationRequest {
  type: 'replaceProcessor' | 'registerPlugin' | 'modifySource';
  target: string;
  payload: unknown;
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3';
  proposedDiff?: FilePatch[];
}

interface SelfModificationResult {
  accepted: boolean;
  verificationReport?: VerificationReport;
  rollbackSnapshotId?: string;
  reason?: string;
}
```

**sandbox→verify→apply 流程：**

```
Agent 调用 replaceProcessor(stage, newProcessorCode)
  ↓
1. SANDBOX: 隔离环境中创建新 Processor 实例（缝隙 5 修补）
   - L2 自举：worker_threads + vm.compileFunction，限制全局变量（无 require/process/fs）
   - L1 自举：子进程 + 临时目录编译，与主进程完全隔离
   - 传入 mock PipelineContext
  ↓
2. VERIFY: 运行完整 Verification Gate 管道 (Gate 1-5)
  ↓
3. APPLY:
   - SnapshotService.track(true)  // 创建回滚点
   - PipelineRunner.register(processor)
   - MutationBudget.consume()
   - 发射 self:mutation:applied
  ↓
4. WATCH: Watchdog 后续监控，退化 → 自动回滚
```

---

### Phase 6 文件清单

| 子阶段 | 新建文件 | 核心改动 |
|--------|---------|---------|
| 6a | `core/src/self-representation.ts`, `.agentforge/self-model.jsonc` | sdk 新增 SelfRepresentation/ModuleInfo/LayerDiagnostic/ModificationRecord 类型 |
| 6b | `core/src/constitution.ts`, `.agentforge/constitution.jsonc` | sdk 新增 Constitution/ProtectedPath/DiffLimits 类型；`state-machine.ts` 新增 forceReset() |
| 6c | `core/src/verification-gate.ts`, `core/src/verification/gates/*.ts` (5个) | sdk 扩展 FilePatch 增加 content/oldContent 字段（缝隙 1），新增 VerificationGate(含timeoutMs)/GateResult/VerificationReport 类型 |
| 6d | `core/src/degeneration-watchdog.ts` | sdk 新增 WatchdogConfig/HealthCheck/WatchdogState 类型 |
| 6e | `core/src/mutation-budget.ts` | sdk 新增 MutationBudgetConfig/MutationBudgetState 类型 |
| 6f | 加固 Phase 5 的三个工具 | sdk 新增 SelfModificationRequest/SelfModificationResult 类型（使用 FilePatch 非 FileDiff），修改 agent.ts 实现 worker_threads sandbox |

---

## 九、完整 6 Phase 依赖图

```
Phase 1a: 配置接管 Pipeline          ─┐ ✅
                                       │ 可并行
Phase 1b: ProcessorRegistry           ─┘ ✅
    ↓ (1b 必须)
Phase 2: 配置接管 Processor
    ↓
Phase 3: 配置接管 Plugin + Hook + Tool ✅
    ↓
Phase 4: 运行时可变性 + 热重载
    ↓
Phase 5: Server 配置驱动 + 间隙优化 + 自指工具
    ↓
Phase 6: 自举安全层
    6a → 6b → 6c → 6d → 6e → 6f

6b ↔ 6c: Constitution 定义边界，Verification Gate 执行检查
6c ↔ 6d: Gate 在修改时验证，Watchdog 在修改后监控
```

---

## 十、完整风险矩阵（Phase 1-6）

| 风险 | 缓解 |
|------|------|
| Processor 依赖注入复杂化 | ProcessorDeps 接口统一所有依赖，工厂函数签名不变 |
| 配置文件 schema 过于复杂 | 分层：顶层默认 + agent 级覆盖，不写=默认 |
| 热重载导致运行中 Agent 状态不一致 | MutabilityPolicy configOnly：变更下次 run() 生效 |
| 自指工具安全风险 | 宪法边界不可逾越；frozen 模式完全禁用 |
| Agent 绕过宪法边界 | Verification Gate 是 Harness 的一部分，Agent 无法绕过 |
| Agent 伪造验证结果 | Gate 4 基准文件列表受宪法 absolute 级别保护 |
| Agent 通过修改测试来通过验证 | Gate 3 只跑 vitest --changed，基线测试集受宪法保护 |
| Watchdog 被 Agent 崩溃影响 | v1 同进程（Agent 崩溃由外部编排器重启）；v2+ worker_threads 隔离 |
| 自修改循环失控 | Mutation Budget 硬限制 + Constitution.diffLimits 不可逾越 |
| **间隙优化在 completed 状态无法修改 Pipeline** | `applyMutation` 要求 pending 状态（loop-orchestrator.ts:167-169），间隙优化前显式 transition('pending') |
| **不可恢复错误卡死 Agent** | `StateMachine.forceReset()` 绕过 isRecoverable，受 Constitution absolute 保护 |
| **间隙运行与用户请求并发** | AbortSignal 联动（agent.ts:191-193 已验证），间隙运行可被抢占 |
| **Mutation Budget 耗尽后空转** | 监听 budget:exceeded 事件，收到后停止间隙优化 |

---

## 十一、Momus 对抗审查记录（2026-05-24）

| 级别 | 发现 | 修正 |
|------|------|------|
| **CRITICAL** | `applyMutation` 只在 `pending` 状态生效，间隙优化在 `completed` 状态无法修改 Pipeline | 间隙优化前显式 `transition('pending')`，运行后再次 `transition('pending')` 应用修改 |
| **CRITICAL** | `error → running` 需要 `isRecoverable`，不可恢复错误会卡死 Agent | `StateMachine.forceReset()` 绕过检查，Constitution `absolute` 保护 `state-machine.ts` |
| **HIGH** | Phase 2 核心工作已完成（`LoopOrchestrator` 已接受 `stageConfig`，`loop-orchestrator.ts:157-159`） | 降级为 Phase 1a（~50 行），原 Phase 2 仅保留 Processor 配置化 |
| **HIGH** | Phase 1 和 Phase 2 不严格有序，Pipeline 配置和 ProcessorRegistry 正交 | Phase 1a/1b 可并行，Phase 2 只依赖 1b |
| **HIGH** | `agent.run()` 内部 AbortController 与外部 signal 是否联动 | **已验证通过**：`agent.ts:191-193` 做了 `signal.addEventListener('abort', () => controller.abort())` |
| **MEDIUM** | `freeze()` 只冻结 PluginManager，不冻结 Pipeline | 修正描述：Pipeline 不可变性的真正守卫是 `applyMutation` 的 `state !== 'pending'` 检查 |
| **MEDIUM** | Watchdog 独立进程需要 IPC，远超 80 行 | v1 同进程交付，v2 worker_threads，v3 独立进程 |
| **MEDIUM** | `eventBus` 是否公开未验证 | **已验证通过**：`agent.ts:145` 已有 `get eventBus()` getter |