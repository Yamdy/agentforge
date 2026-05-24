import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_API_TIMEOUT,
  DEFAULT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_MESSAGES,
  DEFAULT_SESSION_MAX_MESSAGES,
  DEFAULT_COMPRESSION_THRESHOLD,
  COMPRESSION_TOKEN_RATIO,
  DEFAULT_SANDBOX_TIMEOUT,
  DEFAULT_MAX_OUTPUT_SIZE,
  DEFAULT_TIMEOUT_BUFFER,
  DEFAULT_MAX_BROADCAST_DEPTH,
  DEFAULT_WORKFLOW_MAX_ITERATIONS,
  DEFAULT_QUERY_LIMIT,
  DEFAULT_COMPACTION_THRESHOLD,
  DEFAULT_VERSION,
  DEFAULT_LOG_LEVEL,
  DEFAULT_USER_INPUT_TRUNCATE_LENGTH,
  DEFAULT_EXEC_RESULT_TRUNCATE_LENGTH,
  MAX_RESPONSE_SIZE,
} from '../src/constants';

describe('Constants', () => {
  it('should export all server configuration constants', () => {
    expect(DEFAULT_SERVER_PORT).toBe(3000);
    expect(DEFAULT_API_TIMEOUT).toBe(30000);
  });

  it('should export all rate limit constants', () => {
    expect(DEFAULT_MAX_REQUESTS).toBe(100);
    expect(RATE_LIMIT_WINDOW_MS).toBe(60000);
  });

  it('should export all agent configuration constants', () => {
    expect(DEFAULT_MAX_STEPS).toBe(10);
    expect(DEFAULT_MAX_ITERATIONS).toBe(100);
    expect(DEFAULT_MAX_MESSAGES).toBe(100);
    expect(DEFAULT_SESSION_MAX_MESSAGES).toBe(50);
  });

  it('should export all compression constants', () => {
    expect(DEFAULT_COMPRESSION_THRESHOLD).toBe(10);
    expect(COMPRESSION_TOKEN_RATIO).toBe(1.3);
  });

  it('should export all sandbox constants', () => {
    expect(DEFAULT_SANDBOX_TIMEOUT).toBe(30000);
    expect(DEFAULT_MAX_OUTPUT_SIZE).toBe(1024 * 1024);
    expect(DEFAULT_TIMEOUT_BUFFER).toBe(100);
  });

  it('should export all workflow constants', () => {
    expect(DEFAULT_MAX_BROADCAST_DEPTH).toBe(50);
    expect(DEFAULT_WORKFLOW_MAX_ITERATIONS).toBe(100);
  });

  it('should export all storage constants', () => {
    expect(DEFAULT_QUERY_LIMIT).toBe(50);
    expect(DEFAULT_COMPACTION_THRESHOLD).toBe(20);
  });

  it('should export all version and logging constants', () => {
    expect(DEFAULT_VERSION).toBe('1.0.0');
    expect(DEFAULT_LOG_LEVEL).toBe('info');
  });

  it('should export all truncation constants', () => {
    expect(DEFAULT_USER_INPUT_TRUNCATE_LENGTH).toBe(100);
    expect(DEFAULT_EXEC_RESULT_TRUNCATE_LENGTH).toBe(50);
    expect(MAX_RESPONSE_SIZE).toBe(5 * 1024 * 1024);
  });
});
