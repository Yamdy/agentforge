/**
 * Agent 错误类型
 *
 * 为 Agent 运行时提供结构化的错误信息，区分可恢复和不可恢复场景。
 */

import { AppError, type AppErrorOptions } from './types.js';

/**
 * Agent 错误基类
 *
 * 所有 Agent 运行时错误的父类。
 */
export class AgentError extends AppError {
  constructor(
    message: string,
    options?: AppErrorOptions
  ) {
    super('AGENT_ERROR', message, 500, options);
    this.name = 'AgentError';
  }
}

/**
 * Agent 执行超限错误
 *
 * 当 Agent 执行步数超过 maxSteps 限制时抛出。
 * recoverable = false，因为需要修改配置才能继续。
 */
export class AgentMaxStepsError extends AppError {
  constructor(maxSteps: number, currentStep: number) {
    super('AGENT_MAX_STEPS', `Agent exceeded maximum steps: ${currentStep}/${maxSteps}`, 500, {
      context: { maxSteps, currentStep },
      recoverable: false,
    });
    this.name = 'AgentMaxStepsError';
  }
}

/**
 * Agent 超时错误
 *
 * 当 Agent 执行超过指定时间限制时抛出。
 * recoverable = true，可以重试。
 */
export class AgentTimeoutError extends AppError {
  constructor(timeout: number) {
    super('AGENT_TIMEOUT', `Agent execution timed out after ${timeout}ms`, 500, {
      context: { timeout },
      recoverable: true,
    });
    this.name = 'AgentTimeoutError';
  }
}

/**
 * Agent 被取消错误
 *
 * 当 Agent 执行被主动取消时抛出。
 * recoverable = false，因为取消是用户意图。
 */
export class AgentCancelledError extends AppError {
  constructor(reason?: string) {
    super('AGENT_CANCELLED', `Agent execution cancelled${reason ? `: ${reason}` : ''}`, 500, {
      context: { reason },
      recoverable: false,
    });
    this.name = 'AgentCancelledError';
  }
}
