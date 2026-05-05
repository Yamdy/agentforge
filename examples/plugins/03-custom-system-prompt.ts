/**
 * 03-custom-system-prompt.ts — RequestHook 插件
 *
 * 本示例演示 RequestHook 的使用方法：在 LLM 调用前向消息列表注入自定义系统提示。
 *
 * 核心模式：RequestHook.apply(messages, state) → Message[]
 *   - 接收当前消息列表，返回修改后的消息列表
 *   - 多个 RequestHook 按优先级顺序串联执行（前一个的输出是后一个的输入）
 *
 * 优先级系统：使用 DEFAULT_REQUEST_HOOK_PRIORITY（100），位于内置 Hook 之后
 *   - MEMORY(10) → WORKING_MEMORY(20) → SKILL(30)
 *     → DEFAULT_REQUEST_HOOK_PRIORITY(100)
 *
 * 运行方式: npx tsx examples/plugins/03-custom-system-prompt.ts
 */

import type { Plugin } from '../../src/plugins/plugin.js';
import type { RequestHook } from '../../src/core/hooks.js';
import { DEFAULT_REQUEST_HOOK_PRIORITY } from '../../src/core/hooks.js';
import type { Message, AgentState } from '../../src/core/index.js';

/**
 * 自定义系统提示 Hook — 在所有用户自定义 Hook 中最后执行（priority=100）
 *
 * 策略说明：
 *   - system 角色的消息在 LLM 上下文窗口的顶部
 *   - 如果已有 system 消息，追加内容到第一条
 *   - 如果没有 system 消息，在开头插入一条新的
 *   - 每个 Hook 都返回新的消息数组（不修改原数组，遵循不可变性）
 */
const customSystemPromptHook: RequestHook = {
  name: 'custom-system-prompt',
  priority: DEFAULT_REQUEST_HOOK_PRIORITY, // 100 — 用户自定义层

  /**
   * 转换消息列表，注入自定义系统提示。
   *
   * @param messages - 当前消息列表（可能已被前面的 Hook 修改）
   * @param _state   - Agent 循环状态（可用于动态生成提示）
   * @returns 修改后的消息列表
   */
  apply(messages: Message[], _state: AgentState): Message[] {
    // 自定义提示内容（实际使用时可从配置或环境变量读取）
    const customPrompt =
      'You are a helpful coding assistant named AgentForge. ' +
      "Always respond in the same language as the user's message. " +
      'When unsure, ask clarifying questions before proceeding.';

    // 如果第一条消息已经是 system 角色，追加到其内容
    if (messages.length > 0 && messages[0]?.role === 'system') {
      const updated: Message[] = [...messages];
      updated[0] = {
        ...updated[0],
        content: `${updated[0]!.content}\n\n${customPrompt}`,
      };
      return updated;
    }

    // 否则在开头插入新的 system 消息
    const systemMessage: Message = {
      role: 'system',
      content: customPrompt,
    };
    return [systemMessage, ...messages];
  },
};

/**
 * custom-system-prompt 插件 — 声明式系统提示注入
 *
 * 使用场景：
 *   - 根据用户角色动态注入领域知识
 *   - 为不同 Agent 实例设置不同的行为约束
 *   - 在运行时根据 AgentState 动态调整提示词
 *
 * RequestHook 与传统拦截器对比：
 *   - RequestHook 只修改 messages，语义单一、不易出错
 *   - 传统 InterceptorPlugin 需处理整个事件流，复杂度过高
 *   - RequestHook 天然支持串联（每个 Hook 处理前一个的输出）
 */
export const plugin: Plugin = {
  name: 'custom-system-prompt',
  enabled: true,

  // 注册 RequestHook
  requestHooks: [customSystemPromptHook],
};
