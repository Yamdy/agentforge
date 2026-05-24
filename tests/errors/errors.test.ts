/**
 * 错误系统测试
 *
 * 测试所有错误类、类型守卫和辅助函数
 */

import { describe, it, expect } from 'vitest';
import {
  AppError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ValidationError,
  ToolNotFoundError,
  ToolExecuteError,
  LLMError,
} from '../../src/errors/types.js';
import {
  StorageError,
  StorageNotInitializedError,
  ThreadNotFoundError,
  CheckpointNotFoundError,
  AgentStateNotFoundError,
  DatabaseCorruptionError,
  DatabaseWriteError,
  StorageParseError,
} from '../../src/errors/storage.js';
import {
  PermissionError,
  PermissionDeniedError,
  InvalidPermissionRuleError,
} from '../../src/errors/permission.js';
import {
  ConfigError,
  ConfigNotFoundError,
  ConfigValidationError,
  ConfigParseError,
} from '../../src/errors/config.js';
import {
  AgentError,
  AgentMaxStepsError,
  AgentTimeoutError,
  AgentCancelledError,
} from '../../src/errors/agent.js';
import {
  isAppError,
  isStorageError,
  isPermissionError,
  isConfigError,
  isAgentError,
  isNotFoundError,
  isRecoverable,
  isClientError,
  isServerError,
  toAppError,
  getErrorChain,
  formatErrorMessage,
  toErrorResponse,
} from '../../src/errors/guards.js';

// ========== AppError Tests ==========

describe('AppError', () => {
  it('should create basic error', () => {
    const err = new AppError('TEST_ERROR', 'Test message', 400);
    expect(err.code).toBe('TEST_ERROR');
    expect(err.message).toBe('Test message');
    expect(err.status).toBe(400);
    expect(err.recoverable).toBe(false);
    expect(err.context).toBeUndefined();
    expect(err.causeChain).toBeUndefined();
  });

  it('should support options', () => {
    const cause = new Error('Original error');
    const err = new AppError('TEST_ERROR', 'Test', 500, {
      recoverable: true,
      cause,
      context: { foo: 'bar' },
    });
    expect(err.recoverable).toBe(true);
    expect(err.causeChain).toBe(cause);
    expect(err.context).toEqual({ foo: 'bar' });
  });

  it('should serialize to JSON', () => {
    const err = new AppError('TEST', 'Message', 500, {
      context: { key: 'value' },
    });
    const json = err.toJSON();
    expect(json.error.code).toBe('TEST');
    expect(json.error.message).toBe('Message');
    expect(json.error.status).toBe(500);
    expect(json.error.recoverable).toBe(false);
    expect(json.error.context).toEqual({ key: 'value' });
    expect(json.error.timestamp).toBeDefined();
  });

  it('should format toString', () => {
    const cause = new Error('Cause error');
    const err = new AppError('CODE', 'Main error', 500, {
      cause,
      context: { foo: 'bar' },
    });
    const str = err.toString();
    expect(str).toContain('[CODE]');
    expect(str).toContain('Main error');
    expect(str).toContain('Context:');
    expect(str).toContain('Caused by:');
  });

  it('should have timestamp', () => {
    const before = new Date();
    const err = new AppError('TEST', 'msg');
    const after = new Date();
    expect(err.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(err.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ========== Storage Error Tests ==========

describe('Storage Errors', () => {
  it('StorageNotInitializedError should be recoverable', () => {
    const err = new StorageNotInitializedError('getThread');
    expect(err.recoverable).toBe(true);
    expect(err.code).toBe('STORAGE_ERROR'); // Inherits from StorageError
    expect(err.context?.operation).toBe('getThread');
  });

  it('ThreadNotFoundError should have 404 status', () => {
    const err = new ThreadNotFoundError('thread-123');
    expect(err.status).toBe(404);
    expect(err.code).toBe('THREAD_NOT_FOUND');
    expect(err.context).toEqual({ threadId: 'thread-123' });
  });

  it('CheckpointNotFoundError should have correct context', () => {
    const err = new CheckpointNotFoundError('cp-456');
    expect(err.code).toBe('CHECKPOINT_NOT_FOUND');
    expect(err.context).toEqual({ checkpointId: 'cp-456' });
  });

  it('AgentStateNotFoundError should include session and agent', () => {
    const err = new AgentStateNotFoundError('session-1', 'agent-1');
    expect(err.context).toEqual({ sessionId: 'session-1', agentName: 'agent-1' });
  });

  it('DatabaseCorruptionError should not be recoverable', () => {
    const err = new DatabaseCorruptionError('getThread', 'Corrupted data');
    expect(err.recoverable).toBe(false);
  });

  it('DatabaseWriteError should be recoverable', () => {
    const err = new DatabaseWriteError('saveThread', 'Write failed');
    expect(err.recoverable).toBe(true);
  });

  it('StorageParseError should wrap cause', () => {
    const cause = new SyntaxError('Unexpected token');
    const err = new StorageParseError('getCheckpoint', 'messages', cause);
    expect(err.causeChain).toBe(cause);
    expect(err.code).toBe('STORAGE_ERROR'); // Inherits from StorageError
    expect(err.recoverable).toBe(false);
  });
});

// ========== Permission Error Tests ==========

describe('Permission Errors', () => {
  it('PermissionDeniedError should have 403 status', () => {
    const err = new PermissionDeniedError('bash', 'rm -rf /', 'agent-1');
    expect(err.status).toBe(403);
    expect(err.code).toBe('PERMISSION_ERROR'); // Inherits from PermissionError
    expect(err.context).toEqual({
      category: 'bash',
      input: 'rm -rf /',
      agentName: 'agent-1',
    });
  });

  it('PermissionDeniedError should work without agentName', () => {
    const err = new PermissionDeniedError('read', '/etc/passwd');
    expect(err.context?.agentName).toBeUndefined();
  });

  it('InvalidPermissionRuleError should have 400 status', () => {
    const err = new InvalidPermissionRuleError('bad-rule', 'Invalid pattern');
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_PERMISSION_RULE');
    expect(err.recoverable).toBe(false);
  });
});

// ========== Config Error Tests ==========

describe('Config Errors', () => {
  it('ConfigNotFoundError should have 404 status', () => {
    const err = new ConfigNotFoundError('/path/to/config.json');
    expect(err.status).toBe(404);
    expect(err.code).toBe('CONFIG_NOT_FOUND');
    expect(err.context).toEqual({ configPath: '/path/to/config.json' });
  });

  it('ConfigValidationError should store errors array', () => {
    const errors = [
      { field: 'name', message: 'Required' },
      { field: 'model', message: 'Invalid model' },
    ];
    const err = new ConfigValidationError('Validation failed', errors);
    expect(err.code).toBe('CONFIG_ERROR'); // Inherits from ConfigError
    expect(err.validationErrors).toEqual(errors);
    expect(err.context?.errors).toEqual(errors);
  });

  it('ConfigParseError should wrap cause', () => {
    const cause = new SyntaxError('Unexpected token');
    const err = new ConfigParseError('/path/to/config.json', cause);
    expect(err.causeChain).toBe(cause);
    expect(err.code).toBe('CONFIG_ERROR'); // Inherits from ConfigError
  });
});

// ========== Agent Error Tests ==========

describe('Agent Errors', () => {
  it('AgentMaxStepsError should not be recoverable', () => {
    const err = new AgentMaxStepsError(10, 11);
    expect(err.recoverable).toBe(false);
    expect(err.code).toBe('AGENT_MAX_STEPS');
    expect(err.context).toEqual({ maxSteps: 10, currentStep: 11 });
  });

  it('AgentTimeoutError should be recoverable', () => {
    const err = new AgentTimeoutError(30000);
    expect(err.recoverable).toBe(true);
    expect(err.code).toBe('AGENT_TIMEOUT');
    expect(err.context).toEqual({ timeout: 30000 });
  });

  it('AgentCancelledError should not be recoverable', () => {
    const err = new AgentCancelledError('User cancelled');
    expect(err.recoverable).toBe(false);
    expect(err.code).toBe('AGENT_CANCELLED');
    expect(err.context).toEqual({ reason: 'User cancelled' });
  });

  it('AgentCancelledError should work without reason', () => {
    const err = new AgentCancelledError();
    expect(err.message).toBe('Agent execution cancelled');
    expect(err.context?.reason).toBeUndefined();
  });
});

// ========== Type Guard Tests ==========

describe('Type Guards', () => {
  it('isAppError should work', () => {
    const appErr = new AppError('TEST', 'message');
    const nativeErr = new Error('test');
    expect(isAppError(appErr)).toBe(true);
    expect(isAppError(nativeErr)).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it('isStorageError should work', () => {
    const storageErr = new StorageError('getThread', 'test');
    const notFoundErr = new ThreadNotFoundError('t1');
    const appErr = new AppError('TEST', 'msg');
    expect(isStorageError(storageErr)).toBe(true);
    // ThreadNotFoundError extends AppError directly, not StorageError
    expect(isStorageError(notFoundErr)).toBe(false);
    expect(isStorageError(appErr)).toBe(false);
  });

  it('isPermissionError should work', () => {
    const permErr = new PermissionDeniedError('bash', 'cmd');
    const appErr = new AppError('TEST', 'msg');
    expect(isPermissionError(permErr)).toBe(true);
    expect(isPermissionError(appErr)).toBe(false);
  });

  it('isConfigError should work', () => {
    const configErr = new ConfigError('test');
    const notFoundErr = new ConfigNotFoundError('/path');
    const appErr = new AppError('TEST', 'msg');
    expect(isConfigError(configErr)).toBe(true);
    // ConfigNotFoundError extends AppError directly, not ConfigError
    expect(isConfigError(notFoundErr)).toBe(false);
    expect(isConfigError(appErr)).toBe(false);
  });

  it('isAgentError should work', () => {
    const agentErr = new AgentError('test');
    const timeoutErr = new AgentTimeoutError(1000);
    const appErr = new AppError('TEST', 'msg');
    expect(isAgentError(agentErr)).toBe(true);
    // AgentTimeoutError extends AppError directly, not AgentError
    expect(isAgentError(timeoutErr)).toBe(false);
    expect(isAgentError(appErr)).toBe(false);
  });

  it('isNotFoundError should check 404 status', () => {
    const notFound = new ThreadNotFoundError('t1');
    const badRequest = new BadRequestError('Bad');
    expect(isNotFoundError(notFound)).toBe(true);
    expect(isNotFoundError(badRequest)).toBe(false);
  });

  it('isRecoverable should check flag', () => {
    const recoverable = new AgentTimeoutError(1000);
    const nonRecoverable = new AgentMaxStepsError(10, 11);
    expect(isRecoverable(recoverable)).toBe(true);
    expect(isRecoverable(nonRecoverable)).toBe(false);
    expect(isRecoverable(new Error('native'))).toBe(false);
  });

  it('isClientError should check 4xx', () => {
    const clientErr = new BadRequestError('Bad');
    const serverErr = new LLMError('LLM failed');
    expect(isClientError(clientErr)).toBe(true);
    expect(isClientError(serverErr)).toBe(false);
  });

  it('isServerError should check 5xx', () => {
    const serverErr = new LLMError('LLM failed');
    const clientErr = new BadRequestError('Bad');
    expect(isServerError(serverErr)).toBe(true);
    expect(isServerError(clientErr)).toBe(false);
  });
});

// ========== Helper Function Tests ==========

describe('Helper Functions', () => {
  it('toAppError should convert native Error', () => {
    const native = new Error('Native error');
    const app = toAppError(native);
    expect(isAppError(app)).toBe(true);
    expect(app.code).toBe('INTERNAL_ERROR');
    expect(app.message).toBe('Native error');
    expect(app.causeChain).toBe(native);
  });

  it('toAppError should return AppError unchanged', () => {
    const app = new AppError('CUSTOM', 'Custom error');
    const result = toAppError(app);
    expect(result).toBe(app);
  });

  it('toAppError should handle non-Error values', () => {
    const app = toAppError('string error');
    expect(app.code).toBe('INTERNAL_ERROR');
    expect(app.message).toBe('string error');
    expect(app.causeChain).toBeUndefined();
  });

  it('getErrorChain should return single error', () => {
    const err = new Error('Single');
    const chain = getErrorChain(err);
    expect(chain).toHaveLength(1);
    expect(chain[0]).toBe(err);
  });

  it('getErrorChain should trace AppError cause', () => {
    const cause1 = new Error('Cause 1');
    const err = new AppError('TEST', 'Main', 500, { cause: cause1 });
    const chain = getErrorChain(err);
    expect(chain).toHaveLength(2);
    expect(chain[0]).toBe(err);
    expect(chain[1]).toBe(cause1);
  });

  it('getErrorChain should trace nested causes', () => {
    const cause2 = new Error('Cause 2');
    const cause1 = new Error('Cause 1');
    Object.assign(cause1, { cause: cause2 });
    const err = new AppError('TEST', 'Main', 500, { cause: cause1 });
    const chain = getErrorChain(err);
    expect(chain).toHaveLength(3);
    expect(chain[0]).toBe(err);
    expect(chain[1]).toBe(cause1);
    expect(chain[2]).toBe(cause2);
  });

  it('formatErrorMessage should format AppError', () => {
    const err = new AppError('CODE', 'Message', 500, {
      context: { foo: 'bar' },
    });
    const msg = formatErrorMessage(err);
    expect(msg).toContain('[CODE]');
    expect(msg).toContain('Message');
    expect(msg).toContain('Context:');
  });

  it('formatErrorMessage should handle native Error', () => {
    const err = new Error('Native error');
    const msg = formatErrorMessage(err);
    expect(msg).toBe('Native error');
  });

  it('formatErrorMessage should handle string', () => {
    const msg = formatErrorMessage('string error');
    expect(msg).toBe('string error');
  });

  it('toErrorResponse should serialize AppError', () => {
    const err = new AppError('TEST', 'Message', 500, {
      context: { key: 'value' },
    });
    const response = toErrorResponse(err);
    expect(response.error.code).toBe('TEST');
    expect(response.error.message).toBe('Message');
    expect(response.error.status).toBe(500);
    expect(response.error.recoverable).toBe(false);
  });

  it('toErrorResponse should handle native Error', () => {
    const err = new Error('Native error');
    const response = toErrorResponse(err);
    expect(response.error.code).toBe('INTERNAL_ERROR');
    expect(response.error.message).toBe('Native error');
    expect(response.error.status).toBe(500);
    expect(response.error.recoverable).toBe(false);
  });
});

// ========== Common Error Tests ==========

describe('Common Errors', () => {
  it('NotFoundError should have correct defaults', () => {
    const err = new NotFoundError();
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Resource not found');
  });

  it('NotFoundError should accept custom message', () => {
    const err = new NotFoundError('Custom not found');
    expect(err.message).toBe('Custom not found');
  });

  it('BadRequestError should have correct defaults', () => {
    const err = new BadRequestError();
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.status).toBe(400);
  });

  it('UnauthorizedError should have correct defaults', () => {
    const err = new UnauthorizedError();
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.status).toBe(401);
  });

  it('ValidationError should store errors', () => {
    const errors = [{ field: 'name', message: 'Required' }];
    const err = new ValidationError('Validation failed', errors);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.errors).toEqual(errors);
    const json = err.toJSON();
    expect(json.error.details).toEqual(errors);
  });

  it('ToolNotFoundError should include tool name', () => {
    const err = new ToolNotFoundError('my-tool');
    expect(err.code).toBe('TOOL_NOT_FOUND');
    expect(err.message).toContain('my-tool');
  });

  it('ToolExecuteError should include tool name', () => {
    const err = new ToolExecuteError('my-tool', 'Execution failed');
    expect(err.code).toBe('TOOL_EXECUTE_ERROR');
    expect(err.message).toContain('my-tool');
    expect(err.message).toContain('Execution failed');
  });

  it('LLMError should have correct defaults', () => {
    const err = new LLMError('LLM failed');
    expect(err.code).toBe('LLM_ERROR');
    expect(err.status).toBe(500);
  });
});
