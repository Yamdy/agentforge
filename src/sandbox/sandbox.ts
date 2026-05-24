import { CommandExecutor } from './executor.js';
import { createPolicy, isPathAllowed, type PolicyOptions } from './policy.js';
import type { SandboxResult, SandboxExecuteOptions } from './types.js';

/**
 * 沙箱类 - 提供安全的命令执行环境
 */
export class Sandbox {
  private executor: CommandExecutor;
  private policy: ReturnType<typeof createPolicy>;

  constructor(options: PolicyOptions) {
    this.policy = createPolicy(options);
    this.executor = new CommandExecutor(this.policy);
  }

  /**
   * 执行命令
   * @param command 要执行的命令
   * @param options 执行选项
   * @returns 执行结果
   */
  async execute(command: string, options?: SandboxExecuteOptions): Promise<SandboxResult> {
    // 提取命令中的路径并验证
    const pathsInCommand = this.extractPaths(command);
    for (const p of pathsInCommand) {
      if (!this.isPathAllowed(p)) {
        return {
          stdout: '',
          stderr: `Error: Path not allowed: ${p}`,
          exitCode: 1,
          timedOut: false,
          duration: 0,
        };
      }
    }

    return this.executor.execute(command, [], options);
  }

  /**
   * 检查路径是否允许访问
   * @param filePath 要检查的路径
   * @returns 是否允许访问
   */
  isPathAllowed(filePath: string): boolean {
    return isPathAllowed(this.policy, filePath);
  }

  /**
   * 终止当前执行的命令
   */
  kill(): void {
    this.executor.killAll();
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.kill();
    this.executor.dispose();
  }

  /**
   * 从命令字符串中提取路径
   * 简单实现：匹配引号内的内容和常见路径模式
   */
  private extractPaths(command: string): string[] {
    const paths: string[] = [];

    // 匹配引号内的内容
    const quotedPattern = /["']([^"']+)["']/g;
    let match;
    while ((match = quotedPattern.exec(command)) !== null) {
      paths.push(match[1]);
    }

    // 匹配以 / 或 ./ 或 \ 或 .\ 开头的路径
    const pathPattern = /(?<=\s)(\/[^ ]+|\.[/\\][^ ]+|[A-Za-z]:[\\/][^ ]+)/g;
    while ((match = pathPattern.exec(command)) !== null) {
      paths.push(match[0]);
    }

    return paths;
  }
}

/**
 * 创建沙箱实例
 * @param options 沙箱策略选项
 * @returns 沙箱实例
 */
export function createSandbox(options: PolicyOptions): Sandbox {
  return new Sandbox(options);
}
