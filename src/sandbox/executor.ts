import { spawn, ChildProcess } from 'child_process';
import type { SandboxPolicy, SandboxResult, SandboxExecuteOptions } from './types.js';

/**
 * 命令执行器 - 负责在隔离环境中执行命令
 */
export class CommandExecutor {
  private policy: SandboxPolicy;
  private activeProcesses: Set<ChildProcess> = new Set();

  constructor(policy: SandboxPolicy) {
    this.policy = policy;
  }

  /**
   * 执行命令
   * @param command 要执行的命令
   * @param args 命令参数
   * @param options 执行选项
   * @returns 执行结果
   */
  async execute(
    command: string,
    args: string[] = [],
    options: SandboxExecuteOptions = {}
  ): Promise<SandboxResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let truncated = false;

      const proc = spawn(command, args, {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env },
        shell: true,
      });

      this.activeProcesses.add(proc);

      // 设置超时 - 默认 30 秒
      const timeout = this.policy.timeout ?? 30000;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout);

      // 收集标准输出 - 默认 1MB
      const maxOutputSize = this.policy.maxOutputSize ?? 1048576;
      proc.stdout?.on('data', (data: Buffer) => {
        if (!truncated && stdout.length < maxOutputSize) {
          stdout += data.toString('utf8');
          if (stdout.length >= maxOutputSize) {
            stdout = stdout.slice(0, maxOutputSize);
            truncated = true;
          }
        }
      });

      // 收集标准错误
      proc.stderr?.on('data', (data: Buffer) => {
        if (!truncated && stderr.length < maxOutputSize) {
          stderr += data.toString('utf8');
          if (stderr.length >= maxOutputSize) {
            stderr = stderr.slice(0, maxOutputSize);
            truncated = true;
          }
        }
      });

      // 进程结束
      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);

        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          timedOut,
          duration: Date.now() - startTime,
        });
      });

      // 进程错误
      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        this.activeProcesses.delete(proc);

        resolve({
          stdout,
          stderr: err.message,
          exitCode: 1,
          timedOut: false,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * 终止所有活跃进程
   */
  killAll(): void {
    for (const proc of this.activeProcesses) {
      proc.kill('SIGKILL');
    }
    this.activeProcesses.clear();
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.killAll();
  }
}
