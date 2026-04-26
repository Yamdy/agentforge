# 架构总览

> AgentForge 事件流架构的完整架构图、迁移路径和实施路线图。

---

## 架构总览图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AgentForge 事件流架构                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                   L1: 零代码 (配置文件)                            │ │
│  │   agentforge.config.md → createAgent(config) → agent.run()         │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │                   L2: 配置式 (推荐)                                │ │
│  │   createAgent(config) → agent.run() / agent.stream()              │ │
│  │   配置驱动 DI：自动解析 LLM/Tools/Checkpoint/Tracing/MCP          │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │                   L3: 编程式 (RxJS)                                │ │
│  │   agent.run$(input).pipe(timeout(), retry(), tap()).subscribe()   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                   │                                      │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                       操作符层 (可插拔)                             │ │
│  │                                                                     │ │
│  │  控制流: timeout, retry, takeUntil, requirePermission              │ │
│  │  变换:   transformLLMParams, transformToolArgs, compressMessages   │ │
│  │  通知:   logEvents, traceEvents, recordMetrics, exportEvents       │ │
│  │  组合:   productionPreset, debugPreset                              │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                   │                                      │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      Agent Loop (expand)                            │ │
│  │                                                                     │ │
│  │   Observable<AgentEvent>                                            │ │
│  │       │                                                             │ │
│  │       └─ expand(事件 → 下一步事件流)                                │ │
│  │            │                                                        │ │
│  │            ├─ agent.start → llm.request                            │ │
│  │            ├─ llm.request → llm.stream.* → llm.response            │ │
│  │            ├─ llm.response → tool.call[] 或 done                   │ │
│  │            ├─ tool.call → 本地工具 / Subagent / MCP                │ │
│  │            │         ├─ 本地 → tool.execute → tool.result           │ │
│  │            │         ├─ Subagent → subagent.* → 嵌套流冒泡          │ │
│  │            │         └─ MCP → mcp.callTool → tool.result            │ │
│  │            ├─ tool.result → llm.request (循环)                     │ │
│  │            ├─ hitl.ask → 等待 hitl.answer (暂停)                   │ │
│  │            └─ done → EMPTY (终止)                                   │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                   │                                      │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                   轻量 DI (AgentContext)                            │ │
│  │                                                                     │ │
│  │   配置驱动装配: createAgent(config) → ContextBuilder → AgentContext │ │
│  │   编程式组装:   ContextBuilder.create().withLLM().build()          │ │
│  │   测试 Mock:    ContextBuilder + Mock 接口                          │ │
│  │                                                                     │ │
│  │   Context 通过闭包传入事件流处理器（不在事件载荷中）               │ │
│  │                                                                     │ │
│  │   必填: llm, tools                                                  │ │
│  │   可选: checkpoint, hitl, tracer, metrics, mcp, subagents          │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                   │                                      │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      事件流底座 (RxJS + Zod)                       │ │
│  │                                                                     │ │
│  │   Observable<AgentEvent> + Zod discriminatedUnion 验证            │ │
│  │                                                                     │ │
│  │   Layer 1: 核心 Agent Loop (18 种事件)                             │ │
│  │   Layer 2: 子系统生命周期 (15 种事件)                              │ │
│  │   Layer 3: 横切关注点 (7 种事件)                                   │ │
│  │   总计: 40 种类型安全事件                                           │ │
│  │                                                                     │ │
│  │   特性:                                                             │ │
│  │   - 可观测: subscribe()                                             │ │
│  │   - 可中断: takeUntil(), unsubscribe()                              │ │
│  │   - 可恢复: Checkpoint + resumeAgent()                              │ │
│  │   - 重试:   retry()                                                 │ │
│  │   - 超时:   timeout()                                               │ │
│  │   - 打点:   tap()                                                   │ │
│  │   - HITL:   Subject + resume()                                      │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 迁移路径

| 现有机制 | 迁移到 |
|---------|--------|
| Stream Middleware | 直接用 `pipe()` 替换 |
| Lifecycle Middleware | 用 `retryOnEventType()` 或自定义操作符 |
| Plugin Hooks (output 修改) | 用 `transformToolArgs()` 等变换操作符 |
| Plugin Hooks (纯通知) | 用 `tap()` 通知操作符 |
| Checkpoint | 用 `checkpoint()` 操作符 |

---

## 实施路线图

### Phase 1: 核心类型 (1 周)

```
src/core/
├── events.ts          # 40 种事件类型 (Zod discriminatedUnion)
├── state.ts           # AgentState Schema
├── checkpoint.ts      # Checkpoint Schema
├── context.ts         # AgentContext Schema + 接口定义
└── context-builder.ts # ContextBuilder
```

### Phase 2: Agent Core (1.5 周)

```
src/core/
├── agent.ts           # Agent 类 + run/run$/stream 方法
├── handlers/          # 事件处理器
│   ├── llm.ts         # LLM 请求/响应处理
│   ├── tool.ts        # 工具执行处理（含嵌套流）
│   └── hitl.ts        # HITL 处理
└── state-manager.ts   # 状态不可变更新
```

### Phase 3: 操作符库 (1 周)

```
src/operators/
├── control.ts         # timeout, retry, requirePermission
├── transform.ts       # transformLLMParams, transformToolArgs
├── notify.ts          # logEvents, traceEvents, recordMetrics
└── presets.ts         # productionPreset, debugPreset
```

### Phase 4: DI + 工厂 (0.5 周)

```
src/core/
├── config.ts          # AgentConfig Schema + createAgent()
├── factory/           # 工厂函数
│   ├── llm.ts         # createLLMAdapter
│   ├── storage.ts     # createCheckpointStorage
│   └── tracing.ts     # createTracer
└── index.ts           # 公共 API 导出
```

### Phase 5: 子系统适配 (1 周)

```
src/subsystems/
├── mcp/               # MCP 适配层
├── subagent/          # Subagent 适配层
└── workflow/          # Workflow 适配层
```

---

## 部署架构 (P2)

> 基于 Mastra Deployment、Cloudflare Workers、Vercel AI SDK 的设计模式，实现多平台部署能力。

### 设计动机

当前缺少部署能力：
- ❌ 无配置化部署：需要手动配置各平台
- ❌ 无平台抽象：不同平台代码差异大
- ❌ 无 Checkpoint 持久化：Serverless 环境状态丢失

### DeploymentConfig Schema

```typescript
// src/deploy/config.ts

import { z } from 'zod';

export const DeploymentConfigSchema = z.object({
  /** 部署目标平台 */
  target: z.enum([
    'docker',       // Docker 容器
    'cloudflare',   // Cloudflare Workers
    'vercel',       // Vercel Functions
    'lambda',       // AWS Lambda
    'kubernetes',   // Kubernetes
  ]),
  
  /** 运行时配置 */
  runtime: z.object({
    /** Node.js 版本 */
    nodeVersion: z.string().default('20'),
    /** 内存限制 (MB) */
    memory: z.number().optional(),
    /** 超时时间 (秒) */
    timeout: z.number().default(30),
    /** 环境变量 */
    env: z.record(z.string(), z.string()).optional(),
  }).optional(),
  
  /** Checkpoint 存储配置 */
  checkpoint: z.object({
    /** 存储后端 */
    backend: z.enum(['memory', 'postgres', 'mongo', 'redis', 's3']),
    /** 连接字符串 (环境变量名) */
    connectionString: z.string().optional(),
    /** 表名/桶名 */
    tableName: z.string().optional(),
  }).optional(),
  
  /** 平台特定配置 */
  platform: z.union([
    // Docker 配置
    z.object({
      type: z.literal('docker'),
      image: z.string().optional(),
      dockerfile: z.string().optional(),
      ports: z.array(z.number()).optional(),
    }),
    // Cloudflare Workers 配置
    z.object({
      type: z.literal('cloudflare'),
      accountId: z.string(),
      workerName: z.string(),
      compatibilityDate: z.string().default('2024-01-01'),
      kvNamespace: z.string().optional(),
      d1Database: z.string().optional(),
    }),
    // Vercel 配置
    z.object({
      type: z.literal('vercel'),
      projectName: z.string(),
      regions: z.array(z.string()).optional(),
      maxDuration: z.number().optional(),
    }),
    // AWS Lambda 配置
    z.object({
      type: z.literal('lambda'),
      functionName: z.string(),
      region: z.string().default('us-east-1'),
      layers: z.array(z.string()).optional(),
    }),
    // Kubernetes 配置
    z.object({
      type: z.literal('kubernetes'),
      namespace: z.string().default('default'),
      replicas: z.number().default(1),
      image: z.string(),
      ingress: z.object({
        host: z.string(),
        path: z.string().default('/'),
      }).optional(),
    }),
  ]).optional(),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;
```

### Deployer 接口

```typescript
// src/deploy/interfaces.ts

export interface DeployResult {
  success: boolean;
  url?: string;
  deploymentId?: string;
  error?: string;
  logs?: string[];
}

export interface Deployer {
  /** 部署平台名称 */
  platform: string;
  
  /** 执行部署 */
  deploy(config: DeploymentConfig, agentConfig: AgentConfig): Promise<DeployResult>;
  
  /** 检查部署状态 */
  status(deploymentId: string): Promise<DeploymentStatus>;
  
  /** 回滚部署 */
  rollback(deploymentId: string): Promise<DeployResult>;
  
  /** 销毁部署 */
  destroy(deploymentId: string): Promise<void>;
  
  /** 生成部署配置文件 */
  generateConfig(config: DeploymentConfig): string;
}

export interface DeploymentStatus {
  deploymentId: string;
  status: 'pending' | 'building' | 'deploying' | 'active' | 'failed' | 'rolled-back';
  url?: string;
  createdAt: number;
  updatedAt: number;
}
```

### 平台实现示例

#### Docker Deployer

```typescript
// src/deploy/docker-deployer.ts

export class DockerDeployer implements Deployer {
  platform = 'docker';
  
  async deploy(config: DeploymentConfig, agentConfig: AgentConfig): Promise<DeployResult> {
    const platformConfig = config.platform as Extract<DeploymentConfig['platform'], { type: 'docker' }>;
    
    // 1. 生成 Dockerfile
    const dockerfile = this.generateDockerfile(config, agentConfig);
    
    // 2. 构建镜像
    const imageName = `agentforge-${agentConfig.name}:${Date.now()}`;
    await this.exec(`docker build -t ${imageName} .`);
    
    // 3. 运行容器
    const containerId = await this.runContainer(imageName, config);
    
    return {
      success: true,
      deploymentId: containerId,
      url: `http://localhost:${config.runtime?.ports?.[0] ?? 3000}`,
    };
  }
  
  generateConfig(config: DeploymentConfig): string {
    return this.generateDockerfile(config, {} as AgentConfig);
  }
  
  private generateDockerfile(config: DeploymentConfig, agentConfig: AgentConfig): string {
    const nodeVersion = config.runtime?.nodeVersion ?? '20';
    return `
FROM node:${nodeVersion}-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE ${config.runtime?.ports?.[0] ?? 3000}
CMD ["node", "dist/index.js"]
`;
  }
  
  // ... 其他方法实现
}
```

#### Cloudflare Workers Deployer

```typescript
// src/deploy/cloudflare-deployer.ts

export class CloudflareDeployer implements Deployer {
  platform = 'cloudflare';
  
  async deploy(config: DeploymentConfig, agentConfig: AgentConfig): Promise<DeployResult> {
    const platformConfig = config.platform as Extract<DeploymentConfig['platform'], { type: 'cloudflare' }>;
    
    // 1. 生成 Worker 代码
    const workerCode = this.generateWorkerCode(config, agentConfig);
    
    // 2. 生成 wrangler.toml
    const wranglerConfig = this.generateWranglerToml(platformConfig);
    
    // 3. 部署
    const result = await this.exec('npx wrangler deploy');
    
    return {
      success: true,
      deploymentId: `${platformConfig.accountId}-${platformConfig.workerName}`,
      url: `https://${platformConfig.workerName}.${platformConfig.accountId}.workers.dev`,
    };
  }
  
  generateConfig(config: DeploymentConfig): string {
    const platformConfig = config.platform as Extract<DeploymentConfig['platform'], { type: 'cloudflare' }>;
    return this.generateWranglerToml(platformConfig);
  }
  
  private generateWorkerCode(config: DeploymentConfig, agentConfig: AgentConfig): string {
    // 生成适配 Cloudflare Workers 的代码
    // 使用 Durable Objects 或 KV 存储 Checkpoint
    return `
import { createAgent } from 'agentforge';

const agent = createAgent(${JSON.stringify(agentConfig)});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/run' && request.method === 'POST') {
      const { input } = await request.json();
      const result = await agent.run(input);
      return Response.json({ result });
    }
    
    return new Response('Not Found', { status: 404 });
  }
};
`;
  }
  
  private generateWranglerToml(config: Extract<DeploymentConfig['platform'], { type: 'cloudflare' }>): string {
    return `
name = "${config.workerName}"
main = "src/worker.ts"
compatibility_date = "${config.compatibilityDate}"
account_id = "${config.accountId}"

${config.kvNamespace ? `[[kv_namespaces]]\nbinding = "CHECKPOINT"\nid = "${config.kvNamespace}"` : ''}

${config.d1Database ? `[[d1_databases]]\nbinding = "DB"\ndatabase_id = "${config.d1Database}"` : ''}
`;
  }
  
  // ... 其他方法实现
}
```

#### Vercel Deployer

```typescript
// src/deploy/vercel-deployer.ts

export class VercelDeployer implements Deployer {
  platform = 'vercel';
  
  async deploy(config: DeploymentConfig, agentConfig: AgentConfig): Promise<DeployResult> {
    const platformConfig = config.platform as Extract<DeploymentConfig['platform'], { type: 'vercel' }>;
    
    // 1. 生成 API Route
    const apiRoute = this.generateApiRoute(config, agentConfig);
    
    // 2. 生成 vercel.json
    const vercelConfig = this.generateVercelJson(platformConfig);
    
    // 3. 部署
    const result = await this.exec('npx vercel --prod');
    
    return {
      success: true,
      url: result.url,
    };
  }
  
  generateConfig(config: DeploymentConfig): string {
    const platformConfig = config.platform as Extract<DeploymentConfig['platform'], { type: 'vercel' }>;
    return this.generateVercelJson(platformConfig);
  }
  
  private generateApiRoute(config: DeploymentConfig, agentConfig: AgentConfig): string {
    return `
import { createAgent } from 'agentforge';

const agent = createAgent(${JSON.stringify(agentConfig)});

export const config = {
  maxDuration: ${config.runtime?.timeout ?? 30},
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  
  const { input } = await req.json();
  const result = await agent.run(input);
  
  return Response.json({ result });
}
`;
  }
  
  private generateVercelJson(config: Extract<DeploymentConfig['platform'], { type: 'vercel' }>): string {
    return JSON.stringify({
      name: config.projectName,
      regions: config.regions,
      functions: {
        'api/**/*.ts': {
          maxDuration: config.maxDuration,
        },
      },
    }, null, 2);
  }
  
  // ... 其他方法实现
}
```

### Checkpoint 持久化适配

```typescript
// src/storage/postgres-checkpoint-storage.ts

/** PostgreSQL Checkpoint 存储 - 适用于 Serverless 环境 */
export class PostgresCheckpointStorage implements ExternalStateMachine {
  constructor(private pool: Pool) {}
  
  async save(checkpoint: Checkpoint): Promise<void> {
    await this.pool.query(`
      INSERT INTO checkpoints (id, session_id, state, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET state = $3, created_at = $4
    `, [checkpoint.id, checkpoint.sessionId, JSON.stringify(checkpoint), checkpoint.timestamp]);
  }
  
  async load(sessionId: string): Promise<Checkpoint | null> {
    const result = await this.pool.query(`
      SELECT state FROM checkpoints
      WHERE session_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [sessionId]);
    
    return result.rows[0]?.state ?? null;
  }
  
  // ... 其他方法实现
}
```

### 部署命令

```typescript
// src/cli/deploy.ts

export async function deployCommand(config: DeploymentConfig): Promise<void> {
  const deployer = getDeployer(config.target);
  
  // 1. 加载 Agent 配置
  const agentConfig = await loadAgentConfig();
  
  // 2. 执行部署
  console.log(`Deploying to ${config.target}...`);
  const result = await deployer.deploy(config, agentConfig);
  
  if (result.success) {
    console.log(`✅ Deployment successful!`);
    console.log(`   URL: ${result.url}`);
    console.log(`   ID: ${result.deploymentId}`);
  } else {
    console.error(`❌ Deployment failed: ${result.error}`);
    process.exit(1);
  }
}

function getDeployer(target: DeploymentConfig['target']): Deployer {
  switch (target) {
    case 'docker':
      return new DockerDeployer();
    case 'cloudflare':
      return new CloudflareDeployer();
    case 'vercel':
      return new VercelDeployer();
    case 'lambda':
      return new LambdaDeployer();
    case 'kubernetes':
      return new KubernetesDeployer();
    default:
      throw new Error(`Unknown deployment target: ${target}`);
  }
}
```

### 部署配置示例

```yaml
# agentforge.deploy.yaml
target: cloudflare

runtime:
  nodeVersion: "20"
  timeout: 60

checkpoint:
  backend: d1
  tableName: checkpoints

platform:
  type: cloudflare
  accountId: ${CLOUDFLARE_ACCOUNT_ID}
  workerName: my-agent
  d1Database: ${CLOUDFLARE_D1_ID}
```

```bash
# 部署命令
agentforge deploy -c agentforge.deploy.yaml
```

---

## 版本信息

- **设计日期**: 2026-04-24
- **状态**: 设计稿
- **版本**: v4 (P2 新增: 部署架构设计)

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 核心类型定义
- [02-ZOD-CONTRACT.md](./02-ZOD-CONTRACT.md) - Zod 数据契约层
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [04-PROMPT-BUILDER.md](./04-PROMPT-BUILDER.md) - Prompt 构建
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
