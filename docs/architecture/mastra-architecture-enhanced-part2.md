# Mastra 完整架构图（增强版 - 生态系统与示例）

```mermaid
graph TB
    subgraph "Mastra 生态系统"
        MastraInstance["Mastra 实例"]

        subgraph "Monorepo 完整包结构（30+ 包）"
            CorePkg["core<br/>核心框架"]
            InternalCore["_internal-core"]
            Vendored["_vendored"]

            CLIPkg["cli<br/>命令行工具"]
            CreateMastra["create-mastra"]
            Deployer["deployer"]
            Editor["editor"]
            Codemod["codemod"]

            AgentBuilder["agent-builder<br/>代理构建器"]
            Auth["auth"]
            Evals["evals"]
            Loggers["loggers"]
            MCPPkg["mcp<br/>MCP 支持"]
            MCPDocsServer["mcp-docs-server"]
            MemoryPkg["memory"]
            Playground["playground"]
            PlaygroundUI["playground-ui"]
            RAG["rag"]
            SchemaCompat["schema-compat"]
            Server["server"]

            ChangesetCLI["_changeset-cli"]
            Config["_config"]
            ExternalTypes["_external-types"]
            LLMRecorder["_llm-recorder"]
            TestUtils["_test-utils"]
            TypesBuilder["_types-builder"]
        end

        subgraph "认证提供商（10+ 种）"
            Auth0["auth0"]
            BetterAuth["better-auth"]
            Clerk["clerk"]
            Firebase["firebase"]
            Okta["okta"]
            Supabase["supabase"]
            WorkOS["workos"]
            StudioAuth["studio"]
            CloudAuth["cloud"]
        end

        subgraph "客户端 SDK"
            ReactSDK["react"]
            ClientJS["client-js"]
            AISDK["ai-sdk"]
        end

        subgraph "部署器（4 种）"
            VercelDeployer["vercel"]
            NetlifyDeployer["netlify"]
            CloudflareDeployer["cloudflare"]
            CloudDeployer["cloud"]
        end

        subgraph "工作区集成"
            S3["s3"]
            GCS["gcs"]
            E2B["e2b"]
            Blaxel["blaxel"]
            AgentFS["agentfs"]
            Daytona["daytona"]
        end

        subgraph "50+ 示例代码"
            BasicsScorers["basics/scorers/<br/>7 种评分器"]
            BasicsRAG["basics/rag/"]
            AgentExamples["agent/, agent-v6/"]
            BirdCheckerExpress["bird-checker-with-express/"]
            BirdCheckerNext["bird-checker-with-nextjs/"]
            BirdCheckerEval["bird-checker-with-nextjs-and-eval/"]
            WorkflowExamples["workflow-* 系列<br/>6 个工作流示例"]
            MemoryExamples["memory-* 系列<br/>8 个记忆示例"]
            OtherExamples["crypto-chatbot/, dane/,<br/>fireworks-r1/, heads-up-game/,<br/>weather-agent/, stock-price-tool/,<br/>openapi-spec-writer/, yc-directory/,<br/>a2a/, voice/"]
        end

        subgraph "测试结构"
            UnitTests["各包单元测试"]
            E2ETests["e2e-tests/<br/>10+ 端到端测试"]
            Recordings["__recordings__/<br/>测试录音/录像"]
        end

        subgraph "其他重要目录"
            Superset["superset/"]
            EE["ee/<br/>企业版功能"]
            Changeset[".changeset/"]
            DevEnv[".dev/<br/>docker-compose.yaml"]
            Templates["templates/"]
            Patches["patches/<br/>依赖补丁"]
            Scripts["scripts/"]
            Explorations["explorations/"]
            Communications["communications/"]
            PubSub["pubsub/"]
            Mastracode["mastracode/"]
        end

        subgraph "开发配置"
            CursorConfig[".cursor/"]
            ClaudeConfig[".claude/"]
            Husky[".husky/<br/>Git 钩子"]
            Opencode[".opencode/"]
            Turbo["turbo.json"]
            Renovate["renovate.json"]
        end

        subgraph "7 种评分器"
            Toxicity["toxicity"]
            ToneConsistency["tone-consistency"]
            TextualDifference["textual-difference"]
            KeywordCoverage["keyword-coverage"]
            Hallucination["hallucination"]
            AnswerRelevancy["answer-relevancy"]
            SeventhScorer["第 7 种评分器"]
        end
    end

    MastraInstance --> Monorepo 完整包结构
    MastraInstance --> 认证提供商
    MastraInstance --> 客户端 SDK
    MastraInstance --> 部署器
    MastraInstance --> 工作区集成
    MastraInstance --> 50+ 示例代码
    MastraInstance --> 测试结构
    MastraInstance --> 其他重要目录
    MastraInstance --> 开发配置

    Monorepo 完整包结构 --> CorePkg
    Monorepo 完整包结构 --> InternalCore
    Monorepo 完整包结构 --> Vendored
    Monorepo 完整包结构 --> CLIPkg
    Monorepo 完整包结构 --> CreateMastra
    Monorepo 完整包结构 --> Deployer
    Monorepo 完整包结构 --> Editor
    Monorepo 完整包结构 --> Codemod
    Monorepo 完整包结构 --> AgentBuilder
    Monorepo 完整包结构 --> Auth
    Monorepo 完整包结构 --> Evals
    Monorepo 完整包结构 --> Loggers
    Monorepo 完整包结构 --> MCPPkg
    Monorepo 完整包结构 --> MCPDocsServer
    Monorepo 完整包结构 --> MemoryPkg
    Monorepo 完整包结构 --> Playground
    Monorepo 完整包结构 --> PlaygroundUI
    Monorepo 完整包结构 --> RAG
    Monorepo 完整包结构 --> SchemaCompat
    Monorepo 完整包结构 --> Server
    Monorepo 完整包结构 --> ChangesetCLI
    Monorepo 完整包结构 --> Config
    Monorepo 完整包结构 --> ExternalTypes
    Monorepo 完整包结构 --> LLMRecorder
    Monorepo 完整包结构 --> TestUtils
    Monorepo 完整包结构 --> TypesBuilder

    Auth --> 认证提供商
    认证提供商 --> Auth0
    认证提供商 --> BetterAuth
    认证提供商 --> Clerk
    认证提供商 --> Firebase
    认证提供商 --> Okta
    认证提供商 --> Supabase
    认证提供商 --> WorkOS
    认证提供商 --> StudioAuth
    认证提供商 --> CloudAuth

    客户端 SDK --> ReactSDK
    客户端 SDK --> ClientJS
    客户端 SDK --> AISDK

    部署器 --> VercelDeployer
    部署器 --> NetlifyDeployer
    部署器 --> CloudflareDeployer
    部署器 --> CloudDeployer

    工作区集成 --> S3
    工作区集成 --> GCS
    工作区集成 --> E2B
    工作区集成 --> Blaxel
    工作区集成 --> AgentFS
    工作区集成 --> Daytona

    50+ 示例代码 --> BasicsScorers
    50+ 示例代码 --> BasicsRAG
    50+ 示例代码 --> AgentExamples
    50+ 示例代码 --> BirdCheckerExpress
    50+ 示例代码 --> BirdCheckerNext
    50+ 示例代码 --> BirdCheckerEval
    50+ 示例代码 --> WorkflowExamples
    50+ 示例代码 --> MemoryExamples
    50+ 示例代码 --> OtherExamples

    BasicsScorers --> 7 种评分器
    7 种评分器 --> Toxicity
    7 种评分器 --> ToneConsistency
    7 种评分器 --> TextualDifference
    7 种评分器 --> KeywordCoverage
    7 种评分器 --> Hallucination
    7 种评分器 --> AnswerRelevancy
    7 种评分器 --> SeventhScorer

    测试结构 --> UnitTests
    测试结构 --> E2ETests
    测试结构 --> Recordings

    其他重要目录 --> Superset
    其他重要目录 --> EE
    其他重要目录 --> Changeset
    其他重要目录 --> DevEnv
    其他重要目录 --> Templates
    其他重要目录 --> Patches
    其他重要目录 --> Scripts
    其他重要目录 --> Explorations
    其他重要目录 --> Communications
    其他重要目录 --> PubSub
    其他重要目录 --> Mastracode

    开发配置 --> CursorConfig
    开发配置 --> ClaudeConfig
    开发配置 --> Husky
    开发配置 --> Opencode
    开发配置 --> Turbo
    开发配置 --> Renovate
```

---

## 文档清单

- `docs/`：文档目录
- `DEVELOPMENT.md`：开发指南
- `CODE_OF_CONDUCT.md`：行为准则
- `CONTRIBUTING.md`：贡献指南
- `AGENTS.md`：Agent 配置
- `CLAUDE.md`：Claude 相关
