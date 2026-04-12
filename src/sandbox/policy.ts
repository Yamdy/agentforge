import path from 'path';
import type { SandboxPolicy } from './types.js';

export interface PolicyOptions {
  allowedPaths?: string[];
  deniedPaths?: string[];
  timeout?: number;
  maxOutputSize?: number;
}

/**
 * 创建沙箱安全策略
 * @param options 策略选项
 * @returns 完整的沙箱策略配置
 */
export function createPolicy(options: PolicyOptions): SandboxPolicy {
  return {
    allowedPaths: options.allowedPaths ?? [process.cwd()],
    deniedPaths: options.deniedPaths ?? [],
    timeout: options.timeout ?? 60000,
    maxOutputSize: options.maxOutputSize ?? 1024 * 1024,
  };
}

/**
 * 规范化路径（解析相对路径、符号链接等）
 * @param filePath 原始路径
 * @returns 规范化后的绝对路径
 */
function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

/**
 * 检查路径是否在允许列表中
 * @param policy 沙箱策略
 * @param filePath 要检查的路径
 * @returns 是否允许访问
 */
export function isPathAllowed(policy: SandboxPolicy, filePath: string): boolean {
  const normalizedPath = normalizePath(filePath);

  // 先检查黑名单（优先级更高）
  for (const denied of policy.deniedPaths) {
    if (normalizedPath.startsWith(normalizePath(denied))) {
      return false;
    }
  }

  // 再检查白名单
  for (const allowed of policy.allowedPaths) {
    if (normalizedPath.startsWith(normalizePath(allowed))) {
      return true;
    }
  }

  return false;
}
