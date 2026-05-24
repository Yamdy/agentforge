# Workflow Orchestration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现工作流编排系统，包括 Workflow（链式 API）和 MsgHub（消息广播中心）

**Architecture:** 参考 AgentScope 的 MsgHub 简洁设计和 Mastra 的链式 API 风格。仅在 MsgHub 中使用 RxJS，Workflow 使用 Promise。

**Tech Stack:** TypeScript, RxJS (only in MsgHub), Zod, Vitest

---

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
    ├── default.ts              # 默认执行引擎（内部使用）
    └── index.ts
```

---

## Chunk 1: 类型定义和基础结构

**Files:**

- Create: `src/workflow/types.ts`
- Create: `src/workflow/index.ts`
- Modify: `src/index.ts`

### Task 1: 定义类型

- [ ] **Step 1: 创建 types.ts**

```typescript
import { Observable } from 'rxjs';
import type { Agent, Message } from '../types.js';

export interface WorkflowStep<TInput = unknown, TOutput = unknown> {
  id: string;
  description?: string;
  execute: (input: TInput, context: WorkflowContext) => Promise<TOutput>;
}

export interface WorkflowContext {
  getResult<T = unknown>(stepId: string): T | undefined;
  setResult(stepId: string, result: unknown): void;
  getState(): Record<string, unknown>;
  setState(state: Record<string, unknown>): void;
}

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
  path?: string;
}

export interface ParallelOptions {
  description?: string;
}

export interface BranchOptions {
  description?: string;
}

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

export type PipelineFunction = (
  agents: Agent[],
  msg?: Message | Message[]
) => Promise<Message | Message[]>;
```

- [ ] **Step 2: 创建 index.ts**

```typescript
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

- [ ] **Step 3: 更新 src/index.ts，添加 workflow 导出**

在 `src/index.ts` 末尾添加：

```typescript
export * as Workflow from './workflow/index.js';
```

- [ ] **Step 4: Commit**

```bash
git add src/workflow/types.ts src/workflow/index.ts src/index.ts
git commit -m "feat: add workflow orchestration types"
```
