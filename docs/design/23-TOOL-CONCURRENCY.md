# Per-Tool 并发安全判定 — 设计文档

> 状态：待评审
> 阻塞等级：P2 — 当前批次级 `parallelToolCalls` 粒度太粗，无法区分安全/不安全的并行操作
> 参考实现：ClaudeCode `src/Tool.ts` `isConcurrencySafe()` + `src/services/tools/toolOrchestration.ts` `partitionToolCalls()`
> 预估工作量：0.5 天

---

## 1. 问题

当前 AgentForge 的并行工具执行是**批次级**的：

```typescript
// src/loop/handlers/llm.ts — handleLLMResponse()
if (toolCalls.length === 1 || !config.parallelToolCalls) {
  // 串行：一个接一个
} else {
  // 并行：全部一起执行 → executeBatchTools()
}
```

问题：**所有工具调用在同一批次内全部并行执行**，但有些工具组合不应该并行：

```
❌ 错误示例：LLM 同时调用 FileWrite 和 FileRead 同一文件
   → FileRead 可能读到未完成的写入内容

❌ 错误示例：LLM 同时调用 Bash("rm -rf /tmp") 和 Bash("ls /tmp")
   → 竞态条件，ls 可能在 rm 之前或之后执行

✅ 正确示例：Grep("pattern") 和 Glob("*.ts") 可以安全并行
   → 两者都是只读操作
```

### ClaudeCode 的解决方案

ClaudeCode 使用 `isConcurrencySafe(input)` 进行 **per-tool per-input** 判定，然后 `partitionToolCalls()` 将工具调用分批：

```typescript
// ClaudeCode src/services/tools/toolOrchestration.ts (精简)
function* partitionToolCalls(toolUseMessages, context) {
  for (const block of toolUseMessages) {
    const tool = findToolByName(context.options.tools, block.name)
    // 每个工具自行声明：我这个输入是否可以与其他工具并行？
    if (tool?.isConcurrencySafe(block.input)) {
      safeBatch.push(block)       // 可以并行的放在一起
    } else {
      if (safeBatch.length) yield { isConcurrencySafe: true, blocks: safeBatch }
      yield { isConcurrencySafe: false, blocks: [block] }  // 不安全的单独串行
      safeBatch = []
    }
  }
  if (safeBatch.length) yield { isConcurrencySafe: true, blocks: safeBatch }
}
```

核心思想：**工具对自己的并发安全性负责**，不是框架一刀切。

---

## 2. 设计

### 2.1 ToolDefinition 扩展

```typescript
// src/core/interfaces.ts — ToolDefinition 新增方法

export interface ToolDefinition<TInputSchema = unknown, TOutputSchema = unknown> {
  // ... 现有字段 ...
  name: string
  description: string
  parameters: TInputSchema
  execute: (args: unknown, ctx?: ToolContext) => Promise<string>

  // 🔴 新增：并发安全判定
  /**
   * 判定此工具在给定输入下是否可以与其他工具并行执行。
   *
   * - `true`:  此调用是纯读操作，可以与其他工具并行（如 Grep + Glob）
   * - `false`: 此调用有副作用/竞态风险，必须串行执行（如 FileWrite + FileRead）
   *
   * 默认值: `false`（默认保守 — 宁可串行也不错序）
   *
   * 参考 ClaudeCode: Tool.isConcurrencySafe(input)
   *
   * @param args - 工具调用参数（可用于细粒度判定，如只读 bash vs 写操作 bash）
   * @returns 是否可以并行
   */
  isConcurrencySafe?: (args: unknown) => boolean

  // ... 现有字段 (requiresApproval, sandboxRequired, riskLevel) ...
}
```

### 2.2 工具分批算法

```typescript
// src/loop/tool-partition.ts (新文件)

import type { ToolCall } from '../core/events.js'
import type { ToolDefinition } from '../core/interfaces.js'

/**
 * 工具调用分区 — 将一批工具调用按并发安全性分成多个子批次。
 *
 * 算法：遍历工具调用列表，收集连续的安全工具为一批，
 * 遇到不安全工具时立即产出前面的安全批次，然后单独产出不安全工具。
 *
 * 参考 ClaudeCode: src/services/tools/toolOrchestration.ts partitionToolCalls()
 */
export function partitionToolCalls(
  toolCalls: ToolCall[],
  toolDefs: Map<string, ToolDefinition>,
): Array<{ isConcurrencySafe: boolean; calls: ToolCall[] }> {
  const batches: Array<{ isConcurrencySafe: boolean; calls: ToolCall[] }> = []
  let safeBatch: ToolCall[] = []

  for (const tc of toolCalls) {
    const def = toolDefs.get(tc.name)
    const isSafe = def?.isConcurrencySafe?.(tc.args) ?? false

    if (isSafe) {
      safeBatch.push(tc)
    } else {
      // 遇到不安全的工具 → 先提交之前的安全批次
      if (safeBatch.length > 0) {
        batches.push({ isConcurrencySafe: true, calls: [...safeBatch] })
        safeBatch = []
      }
      // 不安全的工具单独成一个批次
      batches.push({ isConcurrencySafe: false, calls: [tc] })
    }
  }

  // 剩余的并行安全工具
  if (safeBatch.length > 0) {
    batches.push({ isConcurrencySafe: true, calls: safeBatch })
  }

  return batches
}
```

### 2.3 分批执行引擎

当前 `executeBatchTools()` 是一次性 `Promise.all()` 所有工具。需要改为**按分区顺序执行**：

```typescript
// src/loop/handlers/tool-execution.ts — 新增 executePartitionedTools()

/**
 * 按并发安全性分批执行工具调用。
 *
 * 应用 partitionToolCalls() 分区后：
 * - 安全批次：内部所有工具并行执行（Promise.all）
 * - 不安全批次：单个工具串行执行（await）
 * - 批次之间严格按顺序执行
 *
 * 替换当前的 executeBatchTools() 或作为其增强版。
 */
export function executePartitionedTools(
  deps: HandlerDeps,
  toolCalls: ToolCall[],
  state: AgentState,
): Observable<StepContext> {
  const { ctx, sessionId } = deps
  const { config, destroy$ } = deps

  // 如果没有启用并行，直接走单工具流程
  if (!config.parallelToolCalls) {
    // 单个工具串行（原有逻辑）
    if (toolCalls.length === 0) return EMPTY
    const firstCall = toolCalls[0]!
    const callEvent: AgentEvent = {
      type: 'tool.call',
      timestamp: Date.now(),
      sessionId,
      toolCallId: firstCall.id,
      toolName: firstCall.name,
      args: firstCall.args,
    }
    return of({ event: callEvent, state } as StepContext)
  }

  // 构建 ToolDefinition 查找表
  const toolDefs = new Map<string, ToolDefinition>()
  for (const name of ctx.tools.list()) {
    const def = ctx.tools.get(name)
    if (def) toolDefs.set(name, def)
  }

  // 分区
  const batches = partitionToolCalls(toolCalls, toolDefs)

  if (batches.length === 0) return EMPTY

  // 构建分批次 Observable
  // 说明：使用手动 Observable 构造器而非 concatMap + mergeMap 的原因是
  // 串行工具执行需要在每个工具完成后累积更新 state（messages 数组），
  // 然后将更新后的 state 传递给下一个工具。RxJS 的 scan 操作符难以
  // 处理基于 Promise 的异步状态累积，因此采用 imperative 方案。
  return new Observable<StepContext>(subscriber => {
    let currentState = state
    // 合并取消信号：destroy$（框架清理）+ abortSignal（用户中断）
    const abortController = new AbortController()
    const destroySub = deps.destroy$?.subscribe(() => abortController.abort()) ?? { unsubscribe: () => {} }
    // 如果 ctx.abortSignal 在 Observable 构造时已经 aborted，立即取消
    if (ctx.abortSignal?.aborted) {
      abortController.abort()
    }
    const abortHandler = (): void => abortController.abort()
    ctx.abortSignal?.addEventListener('abort', abortHandler)

    async function executeBatches(): Promise<void> {
      for (const batch of batches) {
        // 🔴 在每一步开始前检查：subscriber 是否已被取消
        if (subscriber.closed || abortController.signal.aborted) return

        if (batch.isConcurrencySafe && batch.calls.length > 1) {
          // 🔵 并行批：所有工具同时执行
          const batchId = `batch-${generateId()}`
          const startedAt = Date.now()

          if (subscriber.closed) return
          subscriber.next({
            event: {
              type: 'tool.batch.start',
              timestamp: Date.now(),
              sessionId,
              batchId,
              totalCalls: batch.calls.length,
            },
            state: currentState,
          })

          // 并行执行 — 使用 AbortSignal 支持中途取消
          const results = await Promise.all(
            batch.calls.map(async tc => {
              if (abortController.signal.aborted) {
                return { tc, result: 'Cancelled', isError: true }
              }
              try {
                const result = await ctx.tools.execute(tc.name, tc.args)
                return { tc, result, isError: false }
              } catch (error) {
                return {
                  tc,
                  result: error instanceof Error ? error.message : String(error),
                  isError: true,
                }
              }
            })
          )

          // 并行批完成后，再次检查是否被取消
          if (subscriber.closed || abortController.signal.aborted) return

          // 发射每个工具的 execute + result
          for (const r of results) {
            subscriber.next({
              event: {
                type: 'tool.execute',
                timestamp: Date.now(),
                sessionId,
                toolCallId: r.tc.id,
                toolName: r.tc.name,
              },
              state: currentState,
            })
            subscriber.next({
              event: {
                type: 'tool.result',
                timestamp: Date.now(),
                sessionId,
                toolCallId: r.tc.id,
                toolName: r.tc.name,
                result: r.result,
                isError: r.isError,
              },
              state: currentState,
            })
          }

          // 发射 batch.complete
          subscriber.next({
            event: {
              type: 'tool.batch.complete',
              timestamp: Date.now(),
              sessionId,
              batchId,
              totalCalls: batch.calls.length,
              successCount: results.filter(r => !r.isError).length,
              errorCount: results.filter(r => r.isError).length,
              durationMs: Date.now() - startedAt,
            },
            state: currentState,
          })
        } else {
          // 🔴 串行批：每个工具单独执行（等待前一个完成）
          for (const tc of batch.calls) {
            // 🔴 在每个工具执行前检查取消信号
            if (subscriber.closed || abortController.signal.aborted) return

            const result = await new Promise<{ tc: ToolCall; result: string; isError: boolean }>(
              (resolve, reject) => {
                // 订阅 executeToolDirectly 的 Observable
                const toolSub = executeToolDirectly(deps, tc, currentState).subscribe({
                  next(sctx) {
                    if (subscriber.closed) {
                      toolSub.unsubscribe()
                      resolve({ tc, result: 'Cancelled', isError: true })
                      return
                    }
                    subscriber.next(sctx)
                    if (sctx.event.type === 'tool.result') {
                      resolve({
                        tc,
                        result: sctx.event.result as string,
                        isError: sctx.event.isError as boolean,
                      })
                    }
                  },
                  error: reject,
                })
                // 支持 AbortSignal 取消
                abortController.signal.addEventListener('abort', () => {
                  toolSub.unsubscribe()
                  resolve({ tc, result: 'Cancelled', isError: true })
                }, { once: true })
              }
            )

            // 每个工具完成后，再次检查取消信号
            if (subscriber.closed || abortController.signal.aborted) return

            // 更新当前状态以反映消息变化
            currentState = {
              ...currentState,
              messages: [
                ...currentState.messages,
                {
                  role: 'tool',
                  content: result.result,
                  toolCallId: result.tc.id,
                  name: result.tc.name,
                },
              ],
            }
          }
        }
      }

      // 所有批次完成
      subscriber.complete()
    }

    executeBatches().catch(error => {
      subscriber.error(error)
    })

    // 清理：取消所有订阅和事件监听
    return () => {
      destroySub.unsubscribe()
      abortController.abort()
      ctx.abortSignal?.removeEventListener('abort', abortHandler)
    }
  })
}
```

### 2.4 集成到 handleLLMResponse

```typescript
// src/loop/handlers/llm.ts — handleLLMResponse() 工具执行分支修改

// 原有：Parallel tool execution
// const mainFlow$ = executeBatchTools(deps, toolCalls, state)

// 🔴 替换为：
const mainFlow$ = executePartitionedTools(deps, toolCalls, state)
```

### 2.5 工具定义示例

```typescript
// 示例：只读工具可以安全并行
const grepTool: ToolDefinition = {
  name: 'grep',
  description: 'Search file contents using regex',
  parameters: z.object({ pattern: z.string(), path: z.string() }),
  execute: async (args) => { /* ... */ },
  isConcurrencySafe: () => true,   // ✅ grep 是只读的，可以并行
  riskLevel: 'low',
}

const globTool: ToolDefinition = {
  name: 'glob',
  description: 'Find files matching pattern',
  parameters: z.object({ pattern: z.string() }),
  execute: async (args) => { /* ... */ },
  isConcurrencySafe: () => true,   // ✅ glob 是只读的，可以并行
  riskLevel: 'low',
}

// 示例：写操作工具不能并行
const fileWriteTool: ToolDefinition = {
  name: 'file_write',
  description: 'Write content to a file',
  parameters: z.object({ path: z.string(), content: z.string() }),
  execute: async (args) => { /* ... */ },
  isConcurrencySafe: () => false,  // ❌ 写操作有副作用
  riskLevel: 'high',
}

// 示例：Bash 工具根据命令内容动态判定
const bashTool: ToolDefinition = {
  name: 'bash',
  description: 'Execute a shell command',
  parameters: z.object({ command: z.string() }),
  execute: async (args) => { /* ... */ },
  isConcurrencySafe: (args) => {
    // 🔴 细粒度判定：只读命令可以并行，写命令不行
    const cmd = (args as { command: string }).command
    const readOnlyPrefixes = ['ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'stat', 'echo']
    return readOnlyPrefixes.some(p => cmd.trim().startsWith(p))
  },
  riskLevel: 'high',
  requiresApproval: true,
}
```

---

## 3. 涉及文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/core/interfaces.ts` | 修改 | ToolDefinition 新增 `isConcurrencySafe?(args)` |
| `src/loop/tool-partition.ts` | **新建** | `partitionToolCalls()` 分区算法 |
| `src/loop/handlers/tool-execution.ts` | 修改 | 新增 `executePartitionedTools()`；保留原有 `executeBatchTools()` 作为内部实现 |
| `src/loop/handlers/llm.ts` | 修改 | `handleLLMResponse()` 并行分支使用新引擎 |
| `tests/loop/tool-partition.spec.ts` | **新建** | 单元测试：分区算法 |
| `tests/loop/tool-concurrency.spec.ts` | **新建** | 集成测试：分批执行顺序验证 |

---

## 4. 测试计划

```typescript
// tests/loop/tool-partition.spec.ts

describe('partitionToolCalls', () => {
  const safeDef: ToolDefinition = { name: 'grep', /* ... */, isConcurrencySafe: () => true }
  const unsafeDef: ToolDefinition = { name: 'file_write', /* ... */, isConcurrencySafe: () => false }

  const map = new Map([['grep', safeDef], ['file_write', unsafeDef]])

  it('should batch consecutive safe tools together', () => {
    const calls = [
      { id: '1', name: 'grep', args: {} },
      { id: '2', name: 'grep', args: {} },
    ]
    const result = partitionToolCalls(calls, map)
    expect(result).toHaveLength(1)
    expect(result[0]!.isConcurrencySafe).toBe(true)
    expect(result[0]!.calls).toHaveLength(2)
  })

  it('should split when unsafe tool interrupts safe batch', () => {
    const calls = [
      { id: '1', name: 'grep', args: {} },
      { id: '2', name: 'file_write', args: {} },
      { id: '3', name: 'grep', args: {} },
    ]
    const result = partitionToolCalls(calls, map)
    expect(result).toHaveLength(3)
    // Batch 0: [grep] (safe)
    expect(result[0]!.isConcurrencySafe).toBe(true)
    expect(result[0]!.calls).toHaveLength(1)
    // Batch 1: [file_write] (unsafe, alone)
    expect(result[1]!.isConcurrencySafe).toBe(false)
    expect(result[1]!.calls).toHaveLength(1)
    expect(result[1]!.calls[0]!.name).toBe('file_write')
    // Batch 2: [grep] (safe)
    expect(result[2]!.isConcurrencySafe).toBe(true)
  })

  it('should handle all-unsafe tools as individual batches', () => {
    const calls = [
      { id: '1', name: 'file_write', args: {} },
      { id: '2', name: 'file_write', args: {} },
    ]
    const result = partitionToolCalls(calls, map)
    expect(result).toHaveLength(2)
    expect(result[0]!.isConcurrencySafe).toBe(false)
    expect(result[1]!.isConcurrencySafe).toBe(false)
  })

  it('should handle empty input', () => {
    expect(partitionToolCalls([], map)).toHaveLength(0)
  })
})
```

```typescript
// tests/loop/tool-concurrency.spec.ts

describe('executePartitionedTools', () => {
  it('should execute safe tools in parallel', async () => {
    const startTimes: number[] = []
    const safeTool: ToolDefinition = {
      name: 'read',
      execute: async () => {
        startTimes.push(Date.now())
        await delay(50)
        return 'ok'
      },
      isConcurrencySafe: () => true,
    }
    // 验证两个 read 同时开始执行（时间差 < 10ms）
    // ...
  })

  it('should execute unsafe tools sequentially', async () => {
    const order: string[] = []
    const unsafeTool: ToolDefinition = {
      name: 'write',
      execute: async (args) => {
        order.push((args as any).step)
        await delay(10)
        return 'ok'
      },
      isConcurrencySafe: () => false,
    }
    // 验证 write("1") 完成后才执行 write("2")
    // ...
  })

  it('should mix safe batch and unsafe individual', async () => {
    // [grep1, grep2] 并行 → [file_write] 串行 → [grep3] 单独
    // 验证执行顺序
  })
})
```

---

## 5. 向后兼容

- 当 `isConcurrencySafe` 未定义时，默认 `false`（保守安全 — 全部串行执行）
- 当 `config.parallelToolCalls = false` 时，分批逻辑完全不触发（原有单工具串行路径）
- 保留 `executeBatchTools()` 作为内部函数，`executePartitionedTools()` 是新入口

---

## 6. 与 ClaudeCode 的差异

| 维度 | ClaudeCode | AgentForge (本设计) |
|------|-----------|-------------------|
| 语言 | TypeScript (strict: false) | TypeScript (strict: true) + Zod |
| 判定位置 | Tool 接口方法 `isConcurrencySafe(input)` | ToolDefinition 可选方法 `isConcurrencySafe?(args)` |
| 分区算法 | Generator 函数 `partitionToolCalls()` | 数组函数 `partitionToolCalls()` 返回 `Array<Batch>` |
| 执行引擎 | AsyncGenerator `runTools()` + StreamingToolExecutor | RxJS Observable `executePartitionedTools()` |
| 默认值 | `false`（buildTool 填充） | `false`（未定义时） |
| 测试 | 无单元测试 | Vitest 覆盖 |
