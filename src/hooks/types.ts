/**
 * Hook 类型定义
 * 
 * 支持三种 Hook 类型：function、command、http
 * 提供工具执行前后的拦截能力，支持阻塞操作
 */

/**
 * Hook 执行类型
 */
export type HookType = 'function' | 'command' | 'http';

/**
 * Hook 事件类型
 * - PreToolUse: 工具执行前（可阻塞）
 * - PostToolUse: 工具执行后
 * - SessionStart: 会话开始
 * - SessionEnd: 会话结束
 * - PreCompact: 上下文压缩前
 * - PostCompact: 上下文压缩后
 */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'PostCompact';

/**
 * Hook 定义配置
 */
export interface HookDefinition {
  /** Hook 类型 */
  type: HookType;
  /** glob 模式匹配工具名 */
  matcher?: string;
  /** 失败时是否阻塞操作 */
  blockOnFailure: boolean;
  /** 超时时间 (ms) */
  timeout?: number;
  
  // function 类型
  /** 函数处理器名称或函数本身 */
  handler?: string | HookFunction;
  
  // command 类型
  /** 要执行的命令 */
  command?: string;
  
  // http 类型
  /** HTTP 端点 URL */
  url?: string;
  /** HTTP 请求头 */
  headers?: Record<string, string>;
}

/**
 * Hook 函数类型
 * @param input 输入参数
 * @param output 输出参数（可修改）
 * @returns Hook 执行结果
 */
export type HookFunction = (
  input: Record<string, unknown>,
  output: Record<string, unknown>
) => Promise<HookResult | void>;

/**
 * 单个 Hook 执行结果
 */
export interface HookResult {
  /** 是否执行成功 */
  success: boolean;
  /** 是否阻塞操作 */
  blocked: boolean;
  /** 阻塞原因 */
  reason?: string;
  /** 输出内容 */
  output?: string;
}

/**
 * 聚合的 Hook 执行结果
 */
export interface AggregatedHookResult {
  /** 所有 Hook 的执行结果 */
  results: HookResult[];
  /** 是否有任何 Hook 阻塞了操作 */
  blocked: boolean;
  /** 阻塞原因汇总 */
  reason: string;
}

/**
 * Hook 配置
 */
export interface HookConfig {
  /** 按事件类型分组的 Hook 定义 */
  hooks: Record<HookEvent, HookDefinition[]>;
}
