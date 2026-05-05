/**
 * 02-request-logger.ts — LifecycleHook + eventSubscription 插件
 *
 * 本示例演示两种模式的组合使用：
 *   1. lifecycleHooks — 在 LLM 请求/响应前后记录日志
 *   2. eventSubscriptions — 统计事件流中的 token 用量
 *
 * 同时还展示 plugin.state 的跨轮次持久化能力：
 *   - state.requestCount 在每次 llm.request.before 时 +1
 *   - state 对象在会话生命周期内保持引用不变，插件可直接修改
 *
 * 运行方式: npx tsx examples/plugins/02-request-logger.ts
 */

import type { Plugin, PluginContext } from '../../src/plugins/plugin.js';
import type { AgentEvent } from '../../src/core/events.js';
import type { HookFn } from '../../src/core/hooks.js';

// ── 辅助：从事件中提取 token 统计 ──
// 不同事件类型携带的 usage 结构略有不同，做防御性提取
function extractTokenInfo(event: AgentEvent): { prompt: number; completion: number } | null {
  if (event.type === 'llm.response' && 'usage' in event && event.usage) {
    const u = event.usage as { promptTokens?: number; completionTokens?: number };
    return {
      prompt: u.promptTokens ?? 0,
      completion: u.completionTokens ?? 0,
    };
  }
  return null;
}

/**
 * LLM 请求前 Hook — 记录每次 LLM 调用的请求信息
 */
const onRequestBefore: HookFn = function (_input: unknown, _output: unknown): void {
  // _input 包含当前 messages 列表和 model 信息
  // _output 为 {}（before 钩子尚无输出）
  const plugin = requestLogger as Plugin;
  const count = (plugin.state!.requestCount as number) ?? 0;
  plugin.state!.requestCount = count + 1;

  console.log(`[request-logger] LLM request #${count + 1} — sending to model`);
};

/**
 * LLM 响应后 Hook — 记录每次 LLM 响应的摘要信息
 */
const onResponseAfter: HookFn = function (_input: unknown, output: unknown): void {
  // output 包含 LLM 响应数据（content, finishReason, usage 等）
  const resp = output as
    | { finishReason?: string; usage?: { promptTokens?: number; completionTokens?: number } }
    | undefined;
  const finishReason = resp?.finishReason ?? 'unknown';
  const promptTokens = resp?.usage?.promptTokens ?? 0;
  const completionTokens = resp?.usage?.completionTokens ?? 0;

  console.log(
    `[request-logger] LLM response — finish: ${finishReason}, ` +
      `tokens: ${promptTokens}→${completionTokens}`
  );
};

/**
 * 事件处理器 — 统计 token 总用量
 * 通过 eventSubscriptions 注册，非阻塞纯观察模式
 */
function onLLMResponse(event: AgentEvent): void {
  const info = extractTokenInfo(event);
  if (!info) return;

  const plugin = requestLogger as Plugin;
  const totalPrompt = (plugin.state!.totalPromptTokens as number) ?? 0;
  const totalCompletion = (plugin.state!.totalCompletionTokens as number) ?? 0;
  plugin.state!.totalPromptTokens = totalPrompt + info.prompt;
  plugin.state!.totalCompletionTokens = totalCompletion + info.completion;

  // 可选：通过 ctx.tracer 记录 span（如果可用）
  // ctx.tracer?.span('llm.token-usage', { ... });
}

// ── 为了在 Hook 函数中访问插件自身状态，先声明再赋值 ──
let requestLogger: Plugin;

/**
 * request-logger 插件 — 完整的 LLM 交互日志记录方案
 *
 * 两种观测模式对比：
 *
 * lifecycleHooks（同步观测点）:
 *   - 在循环入口处显式调用，与主流程在同一调用栈
 *   - 适合需要在特定时机执行的逻辑（请求前/响应后）
 *   - Hook 异常自动隔离，不抛出
 *
 * eventSubscriptions（异步事件流）:
 *   - 通过 AgentEventEmitter.on() 异步订阅
 *   - 适合持续统计和外部上报
 *   - 执行在微任务队列，不阻塞主循环
 */
requestLogger = {
  name: 'request-logger',
  enabled: true,

  // ── 跨轮次持久化状态 ──
  state: {
    requestCount: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
  },

  // ── 生命周期 Hook — 在精确的切点执行 ──
  lifecycleHooks: [
    {
      phase: 'llm.request.before',
      fn: onRequestBefore,
    },
    {
      phase: 'llm.response.after',
      fn: onResponseAfter,
    },
  ],

  // ── 事件订阅 — 异步观察 token 统计 ──
  eventSubscriptions: [
    {
      event: 'llm.response',
      handler: onLLMResponse,
    },
  ],

  init(ctx: PluginContext): void {
    console.log(`[request-logger] Started logging for session ${ctx.sessionId}`);
  },

  destroy(): void {
    console.log(
      `[request-logger] Session summary: ` +
        `${requestLogger.state!.requestCount} requests, ` +
        `${requestLogger.state!.totalPromptTokens} prompt tokens, ` +
        `${requestLogger.state!.totalCompletionTokens} completion tokens`
    );
  },
};

export { requestLogger as plugin };
