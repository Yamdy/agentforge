import { describe, it, expect } from 'vitest';
import {
  AgentForgeError,
  RecoverableError,
  FatalError,
  AuthError,
  ModelNotFoundError,
  ToolExecutionError,
} from '../src/errors.js';

describe('AgentForgeError hierarchy', () => {
  it('AgentForgeError is base class with name, code, recoverable', () => {
    const err = new AgentForgeError('something broke', { code: 'GENERIC', recoverable: false });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentForgeError);
    expect(err.message).toBe('something broke');
    expect(err.code).toBe('GENERIC');
    expect(err.recoverable).toBe(false);
    expect(err.name).toBe('AgentForgeError');
  });

  it('RecoverableError sets recoverable=true by default', () => {
    const err = new RecoverableError('timeout', { code: 'TIMEOUT' });
    expect(err).toBeInstanceOf(AgentForgeError);
    expect(err.recoverable).toBe(true);
    expect(err.code).toBe('TIMEOUT');
    expect(err.name).toBe('RecoverableError');
  });

  it('FatalError sets recoverable=false by default', () => {
    const err = new FatalError('config invalid', { code: 'CONFIG_ERROR' });
    expect(err).toBeInstanceOf(AgentForgeError);
    expect(err.recoverable).toBe(false);
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.name).toBe('FatalError');
  });

  it('AuthError is a FatalError with code AUTH', () => {
    const err = new AuthError('invalid API key');
    expect(err).toBeInstanceOf(FatalError);
    expect(err).toBeInstanceOf(AgentForgeError);
    expect(err.code).toBe('AUTH');
    expect(err.recoverable).toBe(false);
    expect(err.name).toBe('AuthError');
  });

  it('ModelNotFoundError is a FatalError with code MODEL_NOT_FOUND', () => {
    const err = new ModelNotFoundError('gpt-10');
    expect(err).toBeInstanceOf(FatalError);
    expect(err.code).toBe('MODEL_NOT_FOUND');
    expect(err.message).toContain('gpt-10');
    expect(err.name).toBe('ModelNotFoundError');
  });

  it('ToolExecutionError is RecoverableError with code TOOL_ERROR', () => {
    const err = new ToolExecutionError('search failed');
    expect(err).toBeInstanceOf(RecoverableError);
    expect(err.code).toBe('TOOL_ERROR');
    expect(err.recoverable).toBe(true);
    expect(err.name).toBe('ToolExecutionError');
  });

  it('errors carry retryCount and maxRetries for state machine integration', () => {
    const err = new RecoverableError('timeout', { code: 'TIMEOUT', retryCount: 2, maxRetries: 3 });
    expect(err.retryCount).toBe(2);
    expect(err.maxRetries).toBe(3);
  });

  it('AgentForgeError accepts optional retryHint', () => {
    const err = new AgentForgeError('something broke', { code: 'GENERIC', retryHint: 'Try again with different parameters' });
    expect(err.retryHint).toBe('Try again with different parameters');
  });

  it('AgentForgeError retryHint defaults to undefined', () => {
    const err = new AgentForgeError('something broke', { code: 'GENERIC' });
    expect(err.retryHint).toBeUndefined();
  });

  it('RecoverableError carries retryHint', () => {
    const err = new RecoverableError('timeout', { code: 'TIMEOUT', retryHint: 'Retry after a delay' });
    expect(err.retryHint).toBe('Retry after a delay');
    expect(err.recoverable).toBe(true);
  });

  it('ToolExecutionError accepts retryHint', () => {
    const err = new ToolExecutionError('search failed', undefined, 'Use different search parameters');
    expect(err.retryHint).toBe('Use different search parameters');
    expect(err.code).toBe('TOOL_ERROR');
  });

  it('ToolExecutionError retryHint defaults to undefined', () => {
    const err = new ToolExecutionError('search failed');
    expect(err.retryHint).toBeUndefined();
  });
});
