# Workflow Orchestration System Design

## Overview

工作流编排系统，融合 AgentScope 的 MsgHub 简洁设计和 Mastra 的链式 API 风格。提供两种核心模式：

- **Workflow**：链式 API，用于单代理/多步骤的工作流编排
- **MsgHub**：消息广播中心，用于多代理协作

## Tech Stack

- **Language:** TypeScript (ESM)
- **RxJS:** 仅在 MsgHub 中使用（用于消息广播）
- **Zod:** 运行时类型验证

## Core Abstractions

### 1. Workflow Step

```typescript
export interface WorkflowStep<TInput = unknown, TOutput = unknown> {
  id: string;
  description?: string;
  execute: (input: TInput, context: WorkflowContext) => Promise<TOutput>;
}

export function createStep<TInput, TOutput>(
  id: string,
  execute: (input: TInput, context: WorkflowContext) => Promise<TOutput>,
  options?: { description?: string }
): WorkflowStep<TInput, TOutput> {
  return { id, description: options?.description, execute };
}
```

### 2. Workflow Context

```typescript
export interface WorkflowContext {
  getResult<T = unknown>(stepId: string): T | undefined;
  setResult(stepId: string, result: unknown): void;
  getState(): Record<string, unknown>;
  setState(state: Record<string, unknown>): void;
}
```

### 3. Workflow (链式 API)

```typescript
export interface Workflow<TInput = unknown, TOutput = unknown> {
  id: string;
  step<TI, TO>(
    stepId: string,
    step: WorkflowStep<TI, TO>,
    options?: StepOptions
  ): Workflow<TInput, TO>;
  then<TI, TO>(
    stepId: string,
    step: WorkflowStep<TI, TO>,
    options?: StepOptions
  ): Workflow<TInput, TO>;
  parallel<TI, TO>(
    stepIds: string[],
    steps: WorkflowStep<TI, TO>[],
    options?: ParallelOptions
  ): Workflow<TInput, TO[]>;
  branch<TI, TO>(
    condition: (ctx: WorkflowContext) => boolean,
    branches: {
      true: { id: string; step: WorkflowStep<TI, TO> };
      false: { id: string; step: WorkflowStep<TI, TO> };
    },
    options?: BranchOptions
  ): Workflow<TInput, TO>;
  commit(): CommittedWorkflow<TInput, TOutput>;
}

export interface CommittedWorkflow<TInput = unknown, TOutput = unknown> {
  id: string;
  run(input: TInput): Promise<TOutput>;
}

export interface StepOptions {
  description?: string;
  input?: InputMapping;
}

export interface InputMapping {
  fromStep?: string;
  path?: string; // Dot-notation path (e.g., "result.value")
}

export interface ParallelOptions {
  description?: string;
}

export interface BranchOptions {
  description?: string;
}

// === createAgentStep ===
export function createAgentStep(
  id: string,
  agent: Agent,
  options?: { description?: string }
): WorkflowStep<string, string> {
  return {
    id,
    description: options?.description,
    execute: async (input: string) => agent.run(input),
  };
}
```

### 4. MsgHub (消息广播中心)

使用 RxJS Subject 实现消息广播。

```typescript
import { Observable, Subject } from 'rxjs';
import type { Agent, Message } from '../types.js';

export interface MsgHubConfig {
  participants: Agent[];
  announcement?: Message | Message[];
  enableAutoBroadcast?: boolean;
  name?: string;
}

export interface MsgHub {
  participants: Agent[];
  add(agent: Agent): void;
  delete(agent: Agent): void;
  broadcast(message: Message): void;
  messages$: Observable<Message>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

### 5. Pipeline Functions

```typescript
export type PipelineFunction = (
  agents: Agent[],
  msg?: Message | Message[]
) => Promise<Message | Message[]>;

export function sequentialPipeline(
  agents: Agent[],
  msg?: Message | Message[]
): Promise<Message | Message[]>;

export function parallelPipeline(
  agents: Agent[],
  msg?: Message | Message[],
  options?: { enableGather?: boolean }
): Promise<Message | Message[]>;
```

## File Structure

```
src/workflow/
├── index.ts                    # 主导出
├── types.ts                    # 类型定义
├── context.ts                  # WorkflowContext 实现
├── step.ts                     # Step 基类 + createStep + createAgentStep
├── workflow.ts                 # Workflow 核心类 + createWorkflow
├── msghub.ts                   # MsgHub（消息广播中心，使用 RxJS Subject）
├── pipelines/
│   ├── sequential.ts           # 顺序 Pipeline
│   ├── parallel.ts             # 并行 Pipeline
│   └── index.ts
└── executors/
    ├── default.ts              # 默认执行引擎（内部使用，不导出）
    └── index.ts
```

**Note:** `executors/` 目录包含 Workflow 的内部执行引擎，是 `workflow.ts` 内部使用，不直接导出给用户。

## Core Components

| Component            | File                                   | Description                      |
| -------------------- | -------------------------------------- | -------------------------------- |
| `WorkflowContext`    | `src/workflow/context.ts`              | 工作流上下文，存储步骤结果和状态 |
| `Workflow`           | `src/workflow/workflow.ts`             | 链式 API 工作流编排器            |
| `MsgHub`             | `src/workflow/msghub.ts`               | 消息广播中心（RxJS Subject）     |
| `sequentialPipeline` | `src/workflow/pipelines/sequential.ts` | 顺序执行 Pipeline                |
| `parallelPipeline`   | `src/workflow/pipelines/parallel.ts`   | 并行执行 Pipeline                |

## Usage Examples

### Workflow 链式 API

```typescript
import { createStep, createWorkflow } from 'primo-agent/workflow';

const stepOne = createStep('step1', async (input: number) => input * 2);
const stepTwo = createStep('step2', async (input: number) => input + 10);
const stepLarge = createStep('stepLarge', async (input: number) => input * 100);
const stepSmall = createStep('stepSmall', async (input: number) => input * 2);

const workflow = createWorkflow({ id: 'calculator' })
  .step('step1', stepOne)
  .then('step2', stepTwo, { input: { fromStep: 'step1' } })
  .branch((ctx) => (ctx.getResult('step2') as number) > 10, {
    true: { id: 'stepLarge', step: stepLarge },
    false: { id: 'stepSmall', step: stepSmall },
  })
  .commit();

const result = await workflow.run(5); // 5 * 2 + 10 = 20 > 10 → 20 * 100 = 2000
```

## Error Handling

### Workflow Error Handling

- **Step Failure**: 如果某个 step 抛出错误，Workflow 执行会终止并抛出该错误
- **Error Context**: 错误会包含当前执行到的 step ID 和 WorkflowContext 状态
- **Retry**: 未来可扩展支持 step 级别的重试策略（不在当前 spec 范围内）

### MsgHub Error Handling

- **Agent Error**: 如果某个 agent 在处理消息时抛出错误，错误会被记录但不会中断其他 agents
- **Error Events**: 可以通过 `messages$` Observable 监听错误事件
- **Cleanup**: `[Symbol.asyncDispose]()` 确保资源正确释放，即使发生错误

### MsgHub 多代理协作

**MsgHub 工作原理：**

- `enableAutoBroadcast: true` 时，当任一 agent 调用 `reply()` 时，输出会自动广播给所有其他 participants
- `messages$` Observable 可以用于订阅所有广播的消息（用于日志记录等）
- Pipeline 函数（`sequentialPipeline`、`parallelPipeline`）与 MsgHub 配合使用，通过 `MsgHub` 上下文进行消息传递

```typescript
import { MsgHub, sequentialPipeline } from 'primo-agent/workflow';

const agent1 = new Agent(...);
const agent2 = new Agent(...);
const agent3 = new Agent(...);

// 订阅消息流（可选，用于日志等）
await using hub = new MsgHub({
  participants: [agent1, agent2, agent3],
  announcement: { role: 'system', content: '开始讨论' },
  enableAutoBroadcast: true,
});

// 订阅消息（可选）
hub.messages$.subscribe((msg) => {
  console.log(`[Broadcast] ${msg.role}: ${msg.content}`);
});

// 顺序执行 pipeline，消息通过 MsgHub 自动广播
await sequentialPipeline([agent1, agent2, agent3]);

// 手动广播消息
hub.broadcast({ role: 'system', content: '讨论结束' });
```

### Workflow 与 Agent 集成

```typescript
import { createAgentStep, createWorkflow } from 'primo-agent/workflow';

const agentStep = createAgentStep('agent-step', myAgent);

const workflow = createWorkflow({ id: 'agent-workflow' }).step('agent', agentStep).commit();
```

## Data Flow

### Workflow Execution

```
createWorkflow()
    ↓
.step() / .then() / .parallel() / .branch()
    ↓
.commit() → CommittedWorkflow
    ↓
.run(input)
    ↓
执行步骤图 → WorkflowContext 存储结果
    ↓
返回最终结果
```

### MsgHub Message Flow

```
new MsgHub()
    ↓
(可选) 发送 announcement
    ↓
agents.reply() → 自动 broadcast (enableAutoBroadcast=true)
    ↓
或手动调用 hub.broadcast(message)
    ↓
messages$ Observable 发射消息
    ↓
[Symbol.asyncDispose]() 清理资源
```

## Exports

```typescript
// src/workflow/index.ts
export { createStep, createAgentStep } from './step.js';
export type { WorkflowStep } from './types.js';
export { createWorkflow } from './workflow.js';
export type {
  Workflow,
  CommittedWorkflow,
  WorkflowContext,
  StepOptions,
  InputMapping,
  ParallelOptions,
  BranchOptions,
} from './types.js';
export { MsgHub } from './msghub.js';
export type { MsgHubConfig } from './types.js';
export { sequentialPipeline, parallelPipeline } from './pipelines/index.js';
export type { PipelineFunction } from './types.js';
```
