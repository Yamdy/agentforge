# AgentForge Architecture Diagrams

## 1. Monorepo 依赖关系

```mermaid
graph TD
    SDK["<b>sdk</b><br/>纯类型定义 (554行)<br/>零依赖"]
    TOOLS["<b>tools</b><br/>echo tool"]
    OBS["<b>observability</b><br/>Span/Tracer/Metrics<br/>+ OTel Bridge"]
    CORE["<b>core</b><br/>Pipeline/Agent/LLM<br/>ToolRegistry/Session<br/>LoopOrchestrator/StateMachine<br/>parse-model/serialize"]
    PLUGINS["<b>plugins</b><br/>6个处理器插件"]

    SDK --> TOOLS
    SDK --> OBS
    SDK --> CORE
    CORE --> PLUGINS
    OBS --> CORE

    style SDK fill:#e1f5fe
    style TOOLS fill:#f3e5f5
    style OBS fill:#fff3e0
    style CORE fill:#e8f5e9
    style PLUGINS fill:#fce4ec
```

## 2. Pipeline 生命周期 & Agentic Loop

```mermaid
flowchart TD
    INPUT(["用户 input"]) --> PI

    subgraph PRE_LOOP["PRE_LOOP"]
        PI["<b>processInput</b><br/>解析 Dynamic 配置"]
        BC["<b>buildContext</b><br/>设置 systemPrompt<br/>提取 toolDeclarations"]
    end

    PI --> BC

    subgraph LOOP["AGENTIC LOOP (maxIterations=10)"]
        PS["<b>prepareStep</b><br/>截断历史至50条<br/>刷新 toolDeclarations"]
        ILLM["<b>invokeLLM</b><br/>消息转换 - Compat Rules<br/>- streamText()"]
        PSO["<b>processStepOutput</b><br/>response + toolCalls<br/>写入 messageHistory"]
        ET["<b>executeTools</b><br/>遍历 pendingToolCalls<br/>- registry.executeTool()"]
        EI["<b>evaluateIteration</b><br/>累加 tokenUsage<br/>判定 continue/stop"]
    end

    BC --> PS
    PS --> ILLM
    ILLM --> CONSUME["PipelineRunner<br/>消费 fullStream<br/>提取 text/toolCalls/reasoning"]
    CONSUME --> PSO
    PSO --> ET
    ET --> EI

    EI -->|"有 toolResults - continue"| PS
    EI -->|"无 toolResults - stop<br/>或 token > 100k"| EXIT

    subgraph POST_LOOP["POST_LOOP"]
        PO["<b>processOutput</b><br/>No-op 扩展点"]
    end

    EXIT --> PO
    PO --> OUTPUT(["返回 iteration.response"])

    style PRE_LOOP fill:#e3f2fd
    style LOOP fill:#fff8e1
    style POST_LOOP fill:#f3e5f5
```

## 3. PipelineContext 四区域结构

```mermaid
classDiagram
    class PipelineContext {
        +RequestRegion request
        +AgentRegion agent
        +IterationRegion iteration
        +SessionRegion session
    }

    class RequestRegion {
        +string input
        +string sessionId
    }

    class AgentRegion {
        +AgentConfig config
        +string systemPrompt
        +ToolDecl[] toolDeclarations
        +string[] promptFragments
        +Record providerOptions
    }

    class IterationRegion {
        +number step
        +LoopDirective loopDirective
        +AsyncIterable fullStream
        +Promise~TokenUsage~ usagePromise
        +string response
        +TokenUsage tokenUsage
        +ToolCall[] pendingToolCalls
        +string reasoningContent
        +ToolResult[] toolResults
        +Span span
    }

    class SessionRegion {
        +Message[] messageHistory
        +TokenUsage totalTokenUsage
        +Record custom
    }

    PipelineContext --> RequestRegion
    PipelineContext --> AgentRegion
    PipelineContext --> IterationRegion
    PipelineContext --> SessionRegion
```

## 4. Model 解析 — Gateway Chain

```mermaid
flowchart LR
    MODEL["model string<br/>deepseek/deepseek-v4-flash"] --> PARSE["parseModel()"]
    PARSE --> PROVIDER["provider: deepseek<br/>modelId: deepseek-v4-flash"]

    PROVIDER --> CHAIN["GatewayChain<br/>按注册顺序尝试"]

    subgraph GATEWAYS["注册的 Gateways"]
        direction TB
        CG1["OpenAICompatibleGateway<br/>自定义端点 1"]
        CG2["OpenAICompatibleGateway<br/>自定义端点 2"]
        BIG["BuiltInGateway<br/>openai / anthropic<br/>/ google / deepseek"]
    end

    CHAIN --> CG1
    CG1 -->|"canResolve=false"| CG2
    CG2 -->|"canResolve=false"| BIG
    BIG -->|"resolve()"| RESULT["LanguageModel"]

    subgraph BUILTIN_LOADERS["动态 import + 缓存"]
        L1["@ai-sdk/openai"]
        L2["@ai-sdk/anthropic"]
        L3["@ai-sdk/google"]
        L4["@ai-sdk/deepseek"]
    end

    BIG --> BUILTIN_LOADERS

    style CHAIN fill:#e8f5e9
    style BIG fill:#fff3e0
```

## 5. Provider 兼容系统 — 双层机制

```mermaid
flowchart TD
    HISTORY["messageHistory"] --> CONVERT["toAiSdkMessages()<br/>转为 AI SDK 格式"]
    CONVERT --> CAPABILITIES["detectCapabilities()"]
    CAPABILITIES --> PREEMPT["applyPreemptiveRules()"]

    subgraph PREEMPTIVE["Preemptive Rules (LLM 调用前)"]
        direction TB
        R1["stripUnsupportedReasoning"]
        R2["stripForeignReasoning"]
        R3["ensureAlternatingRoles"]
        R4["fixEmptyAssistantContent"]
    end

    PREEMPT --> R1 & R2 & R3 & R4
    R1 & R2 & R3 & R4 --> LLM_CALL["llm.stream() - streamText()"]

    LLM_CALL -->|"成功"| OK["返回 fullStream"]
    LLM_CALL -->|"API Error"| REACTIVE["applyReactiveRules()"]

    subgraph REACTIVE_RULES["Reactive Rules (错误后修复)"]
        direction TB
        RR1["sanitizeToolCallIds"]
        RR2["deepseekReasoningRequired"]
    end

    REACTIVE --> RR1 & RR2
    RR1 & RR2 -->|"修复成功"| RETRY["重试当前迭代"]
    RR1 & RR2 -->|"无法修复"| THROW["抛出错误"]

    style PREEMPTIVE fill:#e3f2fd
    style REACTIVE_RULES fill:#fce4ec
```

## 6. Agent 类组合关系

```mermaid
classDiagram
    class Agent {
        -AgentConfig config
        -PipelineRunner runner
        -ToolRegistry registry
        -PluginManager pluginManager
        -LanguageModel model
        +constructor(config, options)
        +use(factory) void
        +run(input, signal) Promise
        +stream(input, signal) AsyncGenerator
        -getLLM(systemPrompt) Promise~LLMInvoker~
        -createContext(input) PipelineContext
        -computeLoopStages(ctx, step)
        -registerBuiltinProcessors() void
    }

    class PipelineRunner {
        -Processor[] processors
        -Tracer tracer
        +register(processor) void
        +run(ctx, stages) Promise~RunResult~
        +stream(ctx, stages) AsyncGenerator~StreamEvent~
        -executeStage(ctx, stage, span) Promise
        -consumeStream(ctx) Promise
    }

    class ToolRegistry {
        -Map tools
        -ToolHook[] beforeHooks
        -ToolHook[] afterHooks
        +register(tool) void
        +executeTool(name, args, ctx) Promise~ToolResult~
        +toAiSdkToolSchemas() Record
    }

    class PluginManager {
        -PipelineRunner runner
        -ToolRegistry registry
        -Map hooks
        -EventBus eventBus
        +initializePlugin(factory) void
        +invokeWrapHook(point, data) Promise
    }

    class LLMInvoker {
        -LLMInvokerOptions options
        +invoke(input) Promise~LLMInvokeResult~
        +stream(input) LLMStreamHandle
    }

    Agent *-- PipelineRunner
    Agent *-- ToolRegistry
    Agent *-- PluginManager
    Agent ..> LLMInvoker : creates per request
    PipelineRunner --> Processor : executes
    PluginManager --> PipelineRunner : registers processors
    PluginManager --> ToolRegistry : registers tools
```

## 7. Session 持久化三层架构

```mermaid
flowchart TD
    USER["agent.run()"] --> SM["SessionManagerImpl"]

    subgraph LAYER1["业务逻辑层"]
        SM -->|"start()"| CREATE["创建 SessionRecord<br/>emit agent:start"]
        SM -->|"restore()"| REPLAY["replay events<br/>重建 PipelineContext"]
        SM -->|"suspend()"| SUSP["emit session:suspended"]
        SM -->|"resume()"| RESUME["标记 completed<br/>创建 child session"]
    end

    subgraph LAYER2["事件持久化层"]
        SP["SessionPersistence"] -->|"订阅 12 种事件"| ON["onEvent() - seq 计数器"]
        ON --> Q["per-session write queue<br/>串行化写入"]
    end

    subgraph LAYER3["存储层"]
        FSS["FilesystemSessionStorage"]
        FSS --> META["meta.json"]
        FSS --> JSONL["events.jsonl"]
    end

    SM --> SP
    SP --> FSS

    LAYER1 -.->|"EventBus"| LAYER2

    style LAYER1 fill:#e3f2fd
    style LAYER2 fill:#fff8e1
    style LAYER3 fill:#e8f5e9
```

## 8. Plugin 系统注册流程

```mermaid
flowchart LR
    FACTORY["PluginFactory"] --> API["HarnessAPI"]

    subgraph REGISTRATIONS["插件可注册的资源"]
        direction TB
        P["registerProcessor(stage, processor)"]
        T["registerTool(tool)"]
        H["registerHook(hook)"]
        R["registerResource(declaration)"]
        E["subscribe(eventType, handler)"]
    end

    API --> P & T & H & R & E

    subgraph HOOK_POINTS["12 个 HookPoint"]
        direction LR
        A1["agent.start"]
        A2["agent.end"]
        S1["stage.before"]
        S2["stage.after"]
        L1["llm.before"]
        L2["llm.after"]
        L3["llm.wrap"]
        T1["tool.before"]
        T2["tool.after"]
        T3["tool.wrap"]
        IE["iteration.end"]
        ERR["error"]
    end

    style REGISTRATIONS fill:#f3e5f5
```

## 9. 6 个内置 Plugin 的阶段分布

```mermaid
flowchart LR
    subgraph STAGES["Pipeline Stages"]
        direction TB
        PI["processInput"]
        BC["buildContext"]
        PS["prepareStep"]
        IL["invokeLLM"]
        PSO["processStepOutput"]
        ET["executeTools"]
        EI["evaluateIteration"]
        PO["processOutput"]
        BT["beforeTool"]
    end

    MEM["Memory Plugin"] -->|"检索+存储"| BC
    MEM -->|"存储对话"| PO
    CMP["Compression Plugin"] -->|"压缩历史"| PS
    PRM["Permission Plugin"] -->|"鉴权"| BT
    SKL["Skill Plugin"] -->|"注入摘要 + read_skill"| BC
    EVC["Eviction Plugin"] -->|"tool.wrap hook"| HOOK["Hook: tool.wrap"]
    MCP["MCP Plugin"] -->|"资源 + 工具发现"| RES["Resources + Tools"]

    style MEM fill:#e3f2fd
    style CMP fill:#fff3e0
    style PRM fill:#fce4ec
    style SKL fill:#e8f5e9
    style EVC fill:#f3e5f5
    style MCP fill:#fff8e1
```

## 10. 工具执行生命周期

```mermaid
flowchart TD
    TC["pendingToolCalls"] --> EXEC["executeTools processor"]
    EXEC --> REG["registry.executeTool(name, args)"]

    REG --> VALIDATE{"Zod Schema<br/>验证 input"}
    VALIDATE -->|"失败"| ERR1["返回 ToolResult.error"]
    VALIDATE -->|"成功"| BEFORE["before hooks"]

    BEFORE --> TOOL_EXEC["tool.execute(args, ctx)"]
    TOOL_EXEC -->|"异常"| CATCH["after hooks (error)<br/>返回 error"]
    TOOL_EXEC -->|"成功"| AFTER["after hooks (success)"]

    AFTER --> WRAP["tool.wrap hook"]
    WRAP --> TRUNCATE["truncation (maxOutputLength)"]
    TRUNCATE --> RESULT["ToolResult"]

    RESULT --> MSG["转为 Message role:tool<br/>写入 messageHistory"]

    style VALIDATE fill:#fff3e0
```

## 11. 运行时安全 — 并发 + Fallback + 异步任务

```mermaid
flowchart TD
    subgraph CONCURRENCY["ConcurrencyController"]
        CS["ConcurrencySlot"] --> ACQ["acquire(key)"]
        ACQ -->|"current 小于 max"| GRANT["授予 current++"]
        ACQ -->|"current 大于等于 max"| WAIT["waiter 队列"]
        GRANT --> RELEASE["release() current--<br/>唤醒下一个"]
    end

    subgraph FALLBACK["FallbackRunner"]
        FE["FallbackEntry[] 按优先级排序"]
        FE --> TRY1["尝试 priority=0"]
        TRY1 -->|"成功"| OK["返回"]
        TRY1 -->|"失败"| EMIT["emit task:fallback"]
        EMIT --> TRY2["尝试 priority=1"]
        TRY2 -->|"全部失败"| THROW2["抛出错误"]
    end

    subgraph ASYNC_TASKS["TaskManagerImpl"]
        LAUNCH["launch(config, prompt)"]
        LAUNCH --> SLOT{"需要并发控制?"}
        SLOT -->|"是"| ACQUIRE2["acquire slot"]
        SLOT -->|"否"| RUN
        ACQUIRE2 --> RUN["fire-and-forget"]
        RUN --> AGENT2["Agent.run(signal)"]
        AGENT2 -->|"成功"| COMPLETE["status=completed"]
        AGENT2 -->|"失败"| FAIL["status=failed"]
        RUN -->|"cancel()"| CANCEL["AbortController.abort()"]
    end

    style CONCURRENCY fill:#e3f2fd
    style FALLBACK fill:#fff3e0
    style ASYNC_TASKS fill:#e8f5e9
```

## 12. 配置多层合并

```mermaid
flowchart LR
    subgraph SOURCES["配置源 (低 → 高优先级)"]
        direction TB
        ENV["1. AGENTFORGE_CONFIG<br/>环境变量"]
        GLOBAL["2. config.jsonc<br/>全局配置"]
        PROJECT["3. config.jsonc<br/>项目配置"]
        SESSION["4. agent.run() 参数<br/>运行时"]
    end

    ENV --> L1["Layer 1"]
    GLOBAL --> L2["Layer 2"]
    PROJECT --> L3["Layer 3"]
    SESSION --> L4["Layer 4"]

    L1 --> MERGE["deepMerge()<br/>递归合并"]
    L2 --> MERGE
    L3 --> MERGE
    L4 --> MERGE

    MERGE --> VALIDATE["Zod Schema 验证"]
    VALIDATE --> CONFIG["HarnessConfig"]

    style SOURCES fill:#f3e5f5
```

## 13. LoopOrchestrator + StateMachine 状态流转

```mermaid
stateDiagram-v2
    [*] --> pending : Agent 构造

    pending --> running : run() / stream()
    running --> completed : loopDirective=stop
    running --> paused : suspend()
    running --> cancelled : AbortSignal
    running --> error : 未捕获异常

    paused --> running : resume(sessionId)<br/>反序列化 checkpoint
    completed --> pending : reset()
    cancelled --> pending : reset()
    error --> pending : reset()

    state running {
        [*] --> prepareStep
        prepareStep --> gateLLM : 权限检查
        gateLLM --> invokeLLM : 允许
        gateLLM --> evaluateIteration : 拒绝 (abort)
        invokeLLM --> processStepOutput
        processStepOutput --> gateTool : 有 pendingToolCalls
        gateTool --> executeTools : 允许
        gateTool --> evaluateIteration : 拒绝 (abort)
        executeTools --> evaluateIteration
        processStepOutput --> evaluateIteration : 无 toolCalls
        evaluateIteration --> prepareStep : continue
        evaluateIteration --> [*] : stop / abort
    }
```
