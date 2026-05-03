/**
 * 01-permission-gate.ts — ToolHook-based security plugin
 *
 * 本示例演示 ToolHook 的使用方法：在工具执行前拦截并阻止危险操作。
 *
 * 核心模式：ToolHook.beforeExecute() 返回 boolean
 *   - true  = 允许执行
 *   - false = 阻止执行（Agent 会收到 tool.error 事件）
 *
 * 优先级：使用默认值即可（ToolHook 先于执行运行）
 *
 * 运行方式: npx tsx examples/plugins/01-permission-gate.ts
 */

import type { Plugin, PluginContext } from '../../src/plugins/plugin.js';
import type { ToolHook } from '../../src/core/hooks.js';
import type { ToolCall, AgentState } from '../../src/core/index.js';

// ── 危险命令模式列表 ──
// 使用正则匹配常见的危险 shell 操作
const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+(-rf?|--recursive)/i, // 递归删除
  /sudo\s+/i, // 提权操作
  /chmod\s+777/i, // 全权限开放
  /mkfs\./, // 格式化文件系统
  /dd\s+if=/i, // 磁盘低级写入
  />\s*\/dev\/(sda|nvme)/, // 直接写入块设备
  /:\(\)\s*\{/i, // fork 炸弹
  /curl.*\|\s*(ba)?sh/i, // curl pipe shell
  /wget.*-O-.*\|\s*(ba)?sh/i, // wget pipe shell
  /git\s+clone.*\|\s*(ba)?sh/i, // git clone pipe shell
];

/**
 * 权限门控 Hook — 检查每条 bash 命令是否包含危险模式
 */
const permissionGateHook: ToolHook = {
  name: 'permission-gate',
  priority: 10, // 低数值 = 高优先级，在所有 ToolHook 中尽早执行

  /**
   * 在工具执行前调用。如果返回 false，工具调用被阻止。
   *
   * @param toolCall - LLM 发出的工具调用请求，包含 id、name、args
   * @param _state   - 当前 Agent 循环状态（本示例未使用）
   * @returns true 允许执行，false 阻止执行
   */
  beforeExecute(toolCall: ToolCall, _state: AgentState): boolean {
    // 只检查 bash 工具，其他工具直接放行
    if (toolCall.name !== 'bash') {
      return true;
    }

    // 提取命令字符串（args.command 是 bash 工具的标准参数）
    const command = String(toolCall.args['command'] ?? '');

    // 遍历所有危险模式，匹配即阻止
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        console.warn(`[permission-gate] BLOCKED dangerous command: ${command.slice(0, 80)}...`);
        return false; // 阻止！
      }
    }

    // 命令安全，放行
    return true;
  },
};

/**
 * permission-gate 插件 — 在生产环境中保护 Agent 免受危险命令的影响
 *
 * 架构说明:
 * - ToolHook 在 ToolRegistry.execute() 内部被调用
 * - 所有已注册的 ToolHook 按优先级顺序运行
 * - 任一 Hook 返回 false 即阻止执行，后续 Hook 不再运行
 * - 被阻止的工具调用会生成 tool.error 事件，Agent 循环可据此反思
 */
export const plugin: Plugin = {
  name: 'permission-gate',
  enabled: true,

  // ── 状态：记录被阻止的命令次数（跨轮次持久化） ──
  state: {
    blockedCount: 0,
  },

  // 注册 ToolHook
  toolHooks: [permissionGateHook],

  /**
   * 插件初始化：在 Agent 启动时调用一次
   *
   * PluginContext 提供只读的会话元数据，不包含 LLM/Tools/Memory 等核心能力。
   * 这是有意为之 — 插件不应该直接调用 Agent 核心能力。
   */
  init(ctx: PluginContext): void {
    console.log(
      `[permission-gate] Initialized for agent "${ctx.agentName}" (session: ${ctx.sessionId})`
    );
  },
};
