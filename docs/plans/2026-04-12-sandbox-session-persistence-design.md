# 端侧沙箱与会话持久化设计

**创建时间**: 2026-04-12  
**方案**: 渐进式增强（方案 A）

---

## 一、需求概述

### 1.1 沙箱系统
- **隔离类型**: 进程级隔离（child_process + 资源限制）
- **资源限制**: 文件系统白名单 + 执行超时
- **适用场景**: 端侧应用，轻量级隔离

### 1.2 会话持久化
- **检查点**: 保存 Agent 执行状态，支持中断后恢复
- **会话压缩**: 自动压缩历史消息，节省 token

---

## 二、沙箱系统设计

### 2.1 目录结构

```
src/sandbox/
├── index.ts           # 导出入口
├── sandbox.ts         # Sandbox 核心类
├── executor.ts        # 命令执行器
├── policy.ts          # 安全策略配置
└── types.ts           # 类型定义
```

### 2.2 核心接口

```typescript
// 安全策略
interface SandboxPolicy {
  allowedPaths: string[];      // 文件系统白名单
  deniedPaths: string[];       // 黑名单（优先级更高）
  timeout: number;             // 执行超时（毫秒）
  maxOutputSize: number;       // 最大输出大小（字节）
}

// 沙箱执行结果
interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  duration: number;
}

// 沙箱类
class Sandbox {
  constructor(policy: SandboxPolicy);
  
  // 执行命令
  execute(command: string, args?: string[]): Promise<SandboxResult>;
  
  // 验证路径是否允许访问
  isPathAllowed(path: string): boolean;
  
  // 终止当前执行
  kill(): void;
}
```

### 2.3 默认安全策略

```typescript
const defaultPolicy: SandboxPolicy = {
  allowedPaths: [process.cwd()],
  deniedPaths: ['/etc/passwd', '/etc/shadow', '~/.ssh'],
  timeout: 60000,      // 60秒
  maxOutputSize: 1024 * 1024,  // 1MB
};
```

### 2.4 与 BashTool 集成

```typescript
const BashTool = {
  name: 'bash',
  execute: async (args: { command: string; sandbox?: boolean }) => {
    if (args.sandbox) {
      return sandbox.execute(args.command);
    }
    // 原有逻辑
  }
};
```

---

## 三、会话持久化设计

### 3.1 目录结构

```
src/session/
├── index.ts           # 现有导出
├── storage.ts         # 现有存储（扩展）
├── compaction.ts      # 现有压缩（增强）
├── checkpoint.ts      # 新增：检查点管理
└── types.ts           # 类型定义（扩展）
```

### 3.2 扩展 Session 结构

```typescript
interface Session {
  id: string;
  title: string;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
  compactedAt?: number;
  parentId?: string;
  projectId?: string;
  
  // 新增字段
  checkpoints: Checkpoint[];     // 检查点列表
  currentCheckpointId?: string;  // 当前检查点ID
}

interface Checkpoint {
  id: string;
  sessionId: string;
  stepIndex: number;             // Agent 执行步骤索引
  messages: SessionMessage[];    // 快照消息
  toolCalls: PendingToolCall[];  // 待执行的工具调用
  state: TaskState;              // Agent 状态
  createdAt: number;
  metadata?: Record<string, unknown>;
}
```

### 3.3 检查点管理 API

```typescript
interface CheckpointAPI {
  // 创建检查点
  create(sessionId: string, stepIndex: number, state: TaskState): Promise<Checkpoint>;
  
  // 恢复到检查点
  restore(checkpointId: string): Promise<Session>;
  
  // 列出会话的所有检查点
  list(sessionId: string): Promise<Checkpoint[]>;
  
  // 删除检查点
  delete(checkpointId: string): Promise<boolean>;
}
```

### 3.4 Agent 集成

```typescript
class Agent {
  async runStream(userInput: string, options?: RunOptions): Observable<StreamEvent> {
    // 每个步骤完成后创建检查点
    const checkpoint = await checkpointAPI.create(
      sessionId, 
      step, 
      this.stateMachine.getState()
    );
    
    // 支持从检查点恢复
    if (options?.resumeFromCheckpoint) {
      const restored = await checkpointAPI.restore(options.resumeFromCheckpoint);
      this.history.restore(restored.messages);
    }
  }
}
```

### 3.5 会话压缩增强

```typescript
interface CompactionConfig {
  maxMessages: number;           // 最大保留消息数（默认 50）
  keepSystemMessages: boolean;   // 保留系统消息（默认 true）
  keepToolResults: boolean;      // 保留工具结果（默认 true）
  summaryModel?: string;         // 用于生成摘要的模型
}

interface CompactionResult {
  originalCount: number;
  compactedCount: number;
  summary?: string;              // 压缩生成的摘要
  savedTokens: number;           // 节省的 token 数
}

async function compactSession(
  sessionId: string, 
  config: CompactionConfig
): Promise<CompactionResult>;
```

---

## 四、数据流与错误处理

### 4.1 沙箱执行流程

```
用户请求 → BashTool
    ↓
检查 sandbox 参数
    ↓
┌─────────────────────────────────────┐
│           Sandbox.execute()         │
├─────────────────────────────────────┤
│ 1. 解析命令，提取路径                │
│ 2. 验证路径是否在白名单              │
│ 3. 创建子进程执行命令                │
│ 4. 设置超时定时器                    │
│ 5. 收集 stdout/stderr               │
│ 6. 超时则强制终止                    │
│ 7. 返回执行结果                      │
└─────────────────────────────────────┘
    ↓
返回结果给 Agent
```

### 4.2 检查点创建流程

```
Agent 执行步骤完成
    ↓
┌─────────────────────────────────────┐
│       CheckpointAPI.create()        │
├─────────────────────────────────────┤
│ 1. 收集当前状态                      │
│    - messages 快照                  │
│    - toolCalls 待执行               │
│    - TaskState 状态                 │
│ 2. 生成检查点 ID                    │
│ 3. 持久化到 Storage                 │
│ 4. 更新 Session.checkpoints        │
└─────────────────────────────────────┘
    ↓
继续下一步执行
```

### 4.3 错误处理策略

| 错误类型 | 处理方式 |
|----------|----------|
| **路径拒绝** | 返回错误信息，不执行命令 |
| **执行超时** | 终止进程，返回 `timedOut: true` |
| **进程异常** | 捕获 stderr，返回 `exitCode` |
| **检查点恢复失败** | 回退到上一个有效检查点 |
| **压缩失败** | 保留原始消息，记录警告 |

---

## 五、配置示例

```typescript
// agentforge.config.md
---
agent:
  sandbox:
    enabled: true
    allowedPaths:
      - ./src
      - ./tests
    timeout: 30000
  session:
    autoCheckpoint: true      # 自动创建检查点
    checkpointInterval: 5     # 每 5 步创建一次
    autoCompact: true         # 自动压缩
    maxMessages: 100          # 最大消息数
---
```

---

## 六、实现优先级

### P0 - 核心功能
1. Sandbox 核心类实现
2. 文件系统路径验证
3. 执行超时机制
4. Checkpoint 创建与恢复

### P1 - 增强功能
5. BashTool 沙箱集成
6. 会话自动压缩
7. 配置文件支持

### P2 - 优化
8. 压缩摘要生成（需要 LLM）
9. 检查点清理策略
10. 性能优化
