/**
 * 沙箱配置
 */
export interface SandboxConfig extends SandboxPolicy {
  enabled: boolean;
}

/**
 * 沙箱安全策略配置
 */
export interface SandboxPolicy {
  /** 允许访问的目录白名单 */
  allowedPaths?: string[];
  /** 禁止访问的目录黑名单（优先级高于白名单） */
  deniedPaths?: string[];
  /** 命令执行超时时间（毫秒） */
  timeout?: number;
  /** 最大输出大小（字节） */
  maxOutputSize?: number;
}

/**
 * 沙箱执行结果
 */
export interface SandboxResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 执行时长（毫秒） */
  duration: number;
}

/**
 * 沙箱执行选项
 */
export interface SandboxExecuteOptions {
  /** 命令参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
}
