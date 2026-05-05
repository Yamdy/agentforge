/**
 * 04-tool-profiler.ts — ToolHook (unified) + LifecycleHook 插件
 *
 * 本示例演示统一 ToolHook 接口的两种能力：
 *   1. ToolHook.filter — 在 LLM 看到工具列表之前动态过滤工具
 *   2. LifecycleHook — 挂载在 tool.before/after 切点测量耗时
 *
 * 运行方式: npx tsx examples/plugins/04-tool-profiler.ts
 */

import type { Plugin, PluginContext } from '../../src/plugins/plugin.js';
import type { ToolHook, HookFn } from '../../src/core/hooks.js';
import type { FunctionDefinition, AgentState } from '../../src/core/index.js';

// ── 内部状态：记录工具执行开始时间 ──
// 存储在闭包中而非 plugin.state，因为这是瞬时数据，无需跨轮次持久化
const timers = new Map<string, number>();

/**
 * 工具过滤 Hook — 根据模型能力动态调整可用工具列表
 *
 * 示例场景：
 *   - 某些模型不支持并发工具调用，需移除 mutex 分区外的工具
 *   - 根据当前 Agent 步骤阶段，逐步开放更高级的工具
 *   - 在 compaction 后移除 mark_memory 工具（避免重复记忆）
 */
const toolFilterHook: ToolHook = {
  name: 'tool-profiler-filter',
  priority: 40, // 在 TOOL_DESCRIPTIONS(40) 层执行，与内置工具描述注入同级

  /**
   * 过滤工具列表。
   *
   * @param tools - 当前工具定义列表（可能已被前面的 Hook 修改）
   * @param state - Agent 循环状态
   * @returns 修改后的工具定义列表
   */
  filter(tools: FunctionDefinition[], state: AgentState): FunctionDefinition[] {
    // 示例：根据 step 阶段过滤工具
    // 前 3 步只允许只读工具，之后开放写入工具
    if (state.step <= 3) {
      console.log(`[tool-profiler] Step ${state.step}: restricting to read-only tools`);
      return tools.filter(t => {
        const desc = (t.description ?? '').toLowerCase();
        // 保留不含 "write" "delete" "create" 等写入关键字的工具
        return !/(?:write|delete|create|modify|remove)/i.test(desc);
      });
    }

    // 后续步骤开放全部工具
    console.log(`[tool-profiler] Step ${state.step}: all tools available (${tools.length} total)`);
    return tools;
  },
};

/**
 * 工具执行前 Hook — 记录开始时间
 *
 * input 对象包含 { toolName, toolCallId, args } 等上下文
 */
const onToolBefore: HookFn = function (input: unknown, _output: unknown): void {
  const ctx = input as { toolName?: string; toolCallId?: string } | undefined;
  const toolName = ctx?.toolName ?? 'unknown';
  const toolCallId = ctx?.toolCallId ?? 'unknown';

  // 记录开始时间
  timers.set(toolCallId, Date.now());
  console.log(`[tool-profiler] ${toolName} — started`);
};

/**
 * 工具执行后 Hook — 计算耗时并输出
 *
 * output 对象包含 { result, toolName, toolCallId, duration? } 等
 */
const onToolAfter: HookFn = function (_input: unknown, output: unknown): void {
  const ctx = output as { toolName?: string; toolCallId?: string; isError?: boolean } | undefined;
  const toolName = ctx?.toolName ?? 'unknown';
  const toolCallId = ctx?.toolCallId ?? 'unknown';

  // 计算耗时
  const started = timers.get(toolCallId);
  if (started !== undefined) {
    const duration = Date.now() - started;
    timers.delete(toolCallId); // 清理，避免内存泄漏

    const status = ctx?.isError ? 'FAILED' : 'OK';
    console.log(`[tool-profiler] ${toolName} — ${status} (${duration}ms)`);
  }
};

/**
 * 工具执行错误 Hook — 记录失败信息
 */
const onToolError: HookFn = function (_input: unknown, output: unknown): void {
  const ctx = output as { toolName?: string; error?: { message?: string } } | undefined;
  console.error(
    `[tool-profiler] ${ctx?.toolName ?? 'unknown'} — ERROR: ` +
      `${ctx?.error?.message ?? 'unknown error'}`
  );
};

/**
 * tool-profiler 插件 — 工具调用性能分析与动态过滤
 *
 * 需要同时使用两种 Hook 类型的场景：
 *   - ToolHook.filter: 控制 LLM 看到哪些工具（影响决策空间）
 *   - LifecycleHook: 观测工具实际执行情况（不影响流程）
 *
 * 注意：输入输出对象的具体结构由 Agent 循环在调用时传入，
 * 各切点的 input/output 类型略有不同。实际项目中使用时，
 * 建议通过日志输出观察实际结构再做类型断言。
 */
export const plugin: Plugin = {
  name: 'tool-profiler',
  enabled: true,

  // ── ToolHook.filter — 每次 LLM 调用前过滤工具列表 ──
  toolHooks: [toolFilterHook],

  // ── LifecycleHook — 在工具执行生命周期切点挂载回调 ──
  lifecycleHooks: [
    {
      phase: 'tool.before',
      fn: onToolBefore,
      priority: 50,
    },
    {
      phase: 'tool.after',
      fn: onToolAfter,
      priority: 50,
    },
    {
      phase: 'tool.error',
      fn: onToolError,
      priority: 50,
    },
  ],

  init(ctx: PluginContext): void {
    console.log(`[tool-profiler] Activated for agent "${ctx.agentName}"`);
  },

  destroy(): void {
    // 清理残留的计时器（防御性编程）
    if (timers.size > 0) {
      console.log(`[tool-profiler] Cleaning up ${timers.size} dangling timers`);
      timers.clear();
    }
  },
};
