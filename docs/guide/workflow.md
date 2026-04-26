# 工作流（Workflow）

AgentForge Workflow 提供多步骤编排能力，支持复杂任务的工作流执行和挂起恢复。

## 概述

Workflow 是 Agent 之上的高级抽象，用于编排多步骤任务：

1. 定义一系列步骤，每步调用一个 Agent
2. 将前一步的输出传递给下一步
3. 支持条件跳过、挂起恢复
4. 发出 workflow.* 事件用于可观测性

## 创建工作流

### 定义步骤

```typescript
import { Workflow, WorkflowStep } from 'agentforge';

const steps: WorkflowStep[] = [
  {
    id: 'research',
    prompt: (input) => `Research this topic: ${input.topic}`,
    description: 'Research phase',
  },
  {
    id: 'analyze',
    prompt: (prevOutput) => `Analyze these findings: ${prevOutput}`,
    description: 'Analysis phase',
    skip: (input) => input.skipAnalysis === true,
  },
  {
    id: 'summarize',
    prompt: (prevOutput) => `Create a summary of: ${prevOutput}`,
    description: 'Final summary',
  },
];
```

### 创建 Workflow 实例

```typescript
import { createWorkflow } from 'agentforge';

const workflow = createWorkflow(
  {
    name: 'research-pipeline',
    steps,
  },
  agentContext
);
```

## 执行工作流

### 基本执行

```typescript
import { filter } from 'rxjs/operators';

workflow.run({ topic: 'Quantum Computing' }).subscribe({
  next: (event) => {
    if (event.type === 'workflow.start') {
      console.log('Workflow started');
    } else if (event.type === 'workflow.step.start') {
      console.log(`Step started: ${event.stepName}`);
    } else if (event.type === 'workflow.step.end') {
      console.log(`Step ended: ${event.stepId}, result: ${event.result}`);
    } else if (event.type === 'workflow.complete') {
      console.log('Workflow completed:', event.result);
    }
  },
  complete: () => console.log('Workflow finished'),
});
```

### 事件流结构

```
workflow.start
    ↓
workflow.step.start (step: research)
    ↓
[nested agent.* events]
    ↓
workflow.step.end (step: research, result: success)
    ↓
workflow.step.start (step: analyze)
    ↓
[nested agent.* events]
    ↓
workflow.step.end (step: analyze, result: success)
    ↓
workflow.complete
```

## 挂起与恢复

### 挂起工作流

```typescript
// 挂起当前执行
workflow.suspend('Waiting for user approval');

// 检查执行上下文
const ctx = workflow.getExecutionContext();
console.log(ctx?.state); // 'suspended'
console.log(ctx?.suspensionReason); // 'Waiting for user approval'
```

### 恢复工作流

```typescript
// 恢复执行
workflow.resume();

// 执行上下文状态变更
const ctx = workflow.getExecutionContext();
console.log(ctx?.state); // 'running'
```

### 取消工作流

```typescript
workflow.cancel('User cancelled');

const ctx = workflow.getExecutionContext();
console.log(ctx?.state); // 'cancelled'
```

## 条件跳过

步骤可以通过 `skip` 函数决定是否跳过：

```typescript
const steps: WorkflowStep[] = [
  {
    id: 'step1',
    prompt: () => 'First step',
  },
  {
    id: 'optional-step',
    prompt: () => 'Optional processing',
    skip: (input) => {
      // 如果 input.fastMode 为 true，跳过此步骤
      return input.fastMode === true;
    },
  },
  {
    id: 'step3',
    prompt: () => 'Final step',
  },
];
```

跳过的步骤会产生 `workflow.step.end` 事件，result 为 `'skipped'`：

```typescript
workflow.run({ topic: 'test', fastMode: true }).pipe(
  filter(e => e.type === 'workflow.step.end')
).subscribe(event => {
  if (event.stepId === 'optional-step') {
    console.log(event.result); // 'skipped'
  }
});
```

## 执行上下文

```typescript
interface WorkflowExecutionContext {
  workflowId: string;
  state: 'pending' | 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  totalSteps: number;
  stepOutputs: Map<string, unknown>;
  suspensionReason?: string;
}

// 获取当前上下文
const ctx = workflow.getExecutionContext();

console.log('Progress:', `${ctx?.currentStepIndex}/${ctx?.totalSteps}`);
console.log('State:', ctx?.state);
```

## 步骤间数据传递

前一步的输出会自动作为下一步的输入：

```typescript
const steps: WorkflowStep[] = [
  {
    id: 'generate',
    prompt: (input) => `Generate ideas for: ${input.topic}`,
  },
  {
    id: 'refine',
    // prevOutput 是 'generate' 步骤的 Agent 输出
    prompt: (prevOutput) => `Refine these ideas: ${prevOutput}`,
  },
  {
    id: 'final',
    prompt: (prevOutput) => `Create final summary: ${prevOutput}`,
  },
];
```

## 错误处理

工作流错误通过事件报告：

```typescript
workflow.run(input).subscribe(event => {
  if (event.type === 'workflow.error') {
    console.error('Workflow error:', event.error.message);
    console.log('Failed at step:', event.stepId);
  }
});
```

## Pipeline 模式

AgentForge 提供更简洁的 Pipeline API：

```typescript
import { createPipeline } from 'agentforge';

const pipeline = createPipeline()
  .step('analyze', (ctx) => `Analyze: ${ctx.input}`)
  .step('process', (ctx) => `Process: ${ctx.previousOutput}`)
  .step('output', (ctx) => `Format: ${ctx.previousOutput}`);

pipeline.run({ input: 'test data' }).subscribe();
```

## 相关 API

- [Workflow API](/api/workflow) - 完整类型参考
- [Agent API](/api/create-agent) - Agent 创建
- [事件系统](/guide/events) - workflow.* 事件