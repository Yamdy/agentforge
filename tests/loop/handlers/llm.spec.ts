/**
 * LLM Handler Guard Tests
 *
 * Tests for the 4 LLM request guards wired into src/loop/handlers/llm.ts:
 * 1. circuitBreaker — blocking guard before LLM call
 * 2. rateLimiter — blocking guard before LLM call
 * 3. inputSanitizer — pre-LLM call guard (blocking + observability)
 * 4. errorClassifier — fire-and-forget on LLM error path
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Observable, of, from, firstValueFrom, toArray } from 'rxjs';
import {
  handleLLMRequest,
  callLLM,
  callLLMStreaming,
  estimateTokenCount,
  shouldCompact,
} from '../../../src/loop/handlers/llm.js';
import type { HandlerDeps, StepContext } from '../../../src/loop/agent-loop.js';
import type { AgentContext, AgentState, AgentEvent } from '../../../src/core/index.js';
import { InMemoryStore, DefaultPauseController, SimpleSchemaRegistry } from '../../../src/core/index.js';
import type { LLMAdapter, LLMResponse, ToolRegistry, FunctionDefinition } from '../../../src/core/interfaces.js';
import type { CircuitBreaker, ErrorClassifier, ErrorSeverity } from '../../../src/contracts/mpu-interfaces.js';
import type { RateLimiter, InputSanitizer, AuditLogger } from '../../../src/core/interfaces.js';

// ============================================================
// Mock Factories
// ============================================================

function createMockLLMAdapter(overrides: Partial<LLMAdapter> = {}): LLMAdapter {
  return {
    name: 'mock-llm',
    provider: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: 'Hello!',
      finishReason: 'stop' as const,
    }),
    stream: vi.fn().mockReturnValue(
      of({
        text: 'Hello!',
      }),
    ),
    ...overrides,
  };
}

function createMockToolRegistry(): ToolRegistry {
  return {
    list: () => [],
    has: () => false,
    get: () => undefined,
    getFunctionDef: () => undefined,
    getFunctionDefs: (): FunctionDefinition[] => [],
    execute: async () => '',
    register: () => {},
    registerAll: () => {},
  };
}

function createMockCircuitBreaker(overrides: Partial<CircuitBreaker> = {}): CircuitBreaker {
  return {
    shouldTrip: vi.fn().mockReturnValue(false),
    recordFailure: vi.fn().mockReturnValue(false),
    reset: vi.fn(),
    getState: vi.fn().mockReturnValue('closed'),
    getFailureCount: vi.fn().mockReturnValue(0),
    ...overrides,
  };
}

function createMockRateLimiter(overrides: Partial<RateLimiter> = {}): RateLimiter {
  return {
    check: vi.fn().mockReturnValue(true),
    consume: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

function createMockInputSanitizer(overrides: Partial<InputSanitizer> = {}): InputSanitizer {
  return {
    detectInjection: vi.fn().mockReturnValue({
      isMalicious: false,
      confidence: 0,
      patterns: [],
      sanitizedInput: '',
    }),
    sanitize: vi.fn().mockImplementation((input: string) => input),
    validateToolArgs: vi.fn().mockReturnValue({ valid: true }),
    ...overrides,
  };
}

function createMockErrorClassifier(overrides: Partial<ErrorClassifier> = {}): ErrorClassifier {
  return {
    classify: vi.fn().mockReturnValue('moderate' as ErrorSeverity),
    ...overrides,
  };
}

function createMockAuditLogger(): AuditLogger {
  return {
    append: vi.fn(),
  };
}

function createTestContext(
  llm: LLMAdapter,
  toolRegistry: ToolRegistry,
  extras: Partial<AgentContext> = {},
): AgentContext {
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    memory: new InMemoryStore(),
    pauseController: new DefaultPauseController(),
    services: {
      schemaRegistry: new SimpleSchemaRegistry(),
      llmFactory: { create: () => llm, listProviders: () => [], hasProvider: () => false },
      toolRegistry,
    },
    llm,
    tools: toolRegistry,
    ...extras,
  };
}

function createTestState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    model: { provider: 'mock', model: 'test-model' },
    messages: [{ role: 'user', content: 'Hello' }],
    step: 0,
    maxSteps: 10,
    pendingToolCalls: [],
    output: '',
    tokens: { prompt: 0, completion: 0 },
    ...overrides,
  };
}

function createTestDeps(ctx: AgentContext): HandlerDeps {
  return {
    ctx,
    config: {
      model: { provider: 'mock', model: 'test-model' },
      maxSteps: 10,
      maxLLMRepairAttempts: 3,
      parallelToolCalls: true,
    },
    sessionId: 'test-session',
  };
}

// ============================================================
// Tests: circuitBreaker Guard
// ============================================================

describe('circuitBreaker guard in handleLLMRequest', () => {
  it('should block LLM call when circuit is open (shouldTrip returns true)', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const circuitBreaker = createMockCircuitBreaker({ shouldTrip: vi.fn().mockReturnValue(true) });
    const ctx = createTestContext(llm, tools, { circuitBreaker });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe('agent.error');
    expect((events[0]!.event as AgentEvent & { type: 'agent.error' }).error.name).toBe('CircuitBreakerOpenError');
    expect(events[1]!.event.type).toBe('done');
    expect((events[1]!.event as AgentEvent & { type: 'done' }).reason).toBe('error');

    // LLM should NOT have been called
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('should pass through when circuit is closed (shouldTrip returns false)', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const circuitBreaker = createMockCircuitBreaker({ shouldTrip: vi.fn().mockReturnValue(false) });
    const ctx = createTestContext(llm, tools, { circuitBreaker });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    // Should get llm.response (not blocked)
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.event.type === 'llm.response')).toBe(true);
    expect(llm.chat).toHaveBeenCalled();
  });

  it('should pass through when circuitBreaker is not configured', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const ctx = createTestContext(llm, tools); // no circuitBreaker
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.event.type === 'llm.response')).toBe(true);
    expect(llm.chat).toHaveBeenCalled();
  });
});

// ============================================================
// Tests: rateLimiter Guard
// ============================================================

describe('rateLimiter guard in handleLLMRequest', () => {
  it('should block LLM call when rate limit exceeded', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const rateLimiter = createMockRateLimiter({ check: vi.fn().mockReturnValue(false) });
    const ctx = createTestContext(llm, tools, { rateLimiter });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe('agent.error');
    expect((events[0]!.event as AgentEvent & { type: 'agent.error' }).error.name).toBe('RateLimitExceededError');
    expect(events[1]!.event.type).toBe('done');
    expect((events[1]!.event as AgentEvent & { type: 'done' }).reason).toBe('error');

    // LLM should NOT have been called
    expect(llm.chat).not.toHaveBeenCalled();
    // consume should NOT have been called (blocked before consume)
    expect(rateLimiter.consume).not.toHaveBeenCalled();
  });

  it('should consume quota and pass through when rate limit allows', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const rateLimiter = createMockRateLimiter({ check: vi.fn().mockReturnValue(true) });
    const ctx = createTestContext(llm, tools, { rateLimiter });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    // Should get llm.response (not blocked)
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.event.type === 'llm.response')).toBe(true);
    expect(llm.chat).toHaveBeenCalled();

    // consume should have been called with correct key
    expect(rateLimiter.consume).toHaveBeenCalledWith('llm:test-session', {
      maxRequests: 100,
      windowMs: 60000,
    });
  });

  it('should pass through when rateLimiter is not configured', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const ctx = createTestContext(llm, tools); // no rateLimiter
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.event.type === 'llm.response')).toBe(true);
    expect(llm.chat).toHaveBeenCalled();
  });

  it('should check rate limiter AFTER circuit breaker', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    // Circuit breaker is open — should block before rate limiter is checked
    const circuitBreaker = createMockCircuitBreaker({ shouldTrip: vi.fn().mockReturnValue(true) });
    const rateLimiter = createMockRateLimiter();
    const ctx = createTestContext(llm, tools, { circuitBreaker, rateLimiter });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    // Should be blocked by circuit breaker
    expect(events[0]!.event.type).toBe('agent.error');
    expect((events[0]!.event as AgentEvent & { type: 'agent.error' }).error.name).toBe('CircuitBreakerOpenError');

    // Rate limiter should NOT have been checked (circuit breaker blocked first)
    expect(rateLimiter.check).not.toHaveBeenCalled();
  });
});

// ============================================================
// Tests: inputSanitizer Guard
// ============================================================

describe('inputSanitizer guard in doLLMRequest (via handleLLMRequest)', () => {
  it('should block LLM call on high confidence injection detection', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const inputSanitizer = createMockInputSanitizer({
      detectInjection: vi.fn().mockReturnValue({
        isMalicious: true,
        confidence: 0.95,
        patterns: ['prompt_injection', 'role_play'],
        sanitizedInput: '',
      }),
    });
    const ctx = createTestContext(llm, tools, { inputSanitizer });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe('agent.error');
    const errorEv = events[0]!.event as AgentEvent & { type: 'agent.error' };
    expect(errorEv.error.name).toBe('InjectionDetectedError');
    expect(errorEv.error.message).toContain('prompt_injection');
    expect(errorEv.error.message).toContain('role_play');
    expect(events[1]!.event.type).toBe('done');
    expect((events[1]!.event as AgentEvent & { type: 'done' }).reason).toBe('error');

    // LLM should NOT have been called
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('should log but NOT block on low confidence injection detection', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const auditLogger = createMockAuditLogger();
    const inputSanitizer = createMockInputSanitizer({
      detectInjection: vi.fn().mockReturnValue({
        isMalicious: true,
        confidence: 0.5,
        patterns: ['suspicious_pattern'],
        sanitizedInput: '',
      }),
    });
    const ctx = createTestContext(llm, tools, { inputSanitizer, auditLogger });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    // Should NOT be blocked — should get llm.response
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.event.type === 'llm.response')).toBe(true);
    expect(llm.chat).toHaveBeenCalled();

    // Audit logger should have been called
    expect(auditLogger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-session',
        agentName: 'test-agent',
        eventType: 'injection.detected',
        action: 'llm.request',
        resource: 'user_input',
        result: 'success',
        details: expect.objectContaining({
          confidence: 0.5,
          patterns: ['suspicious_pattern'],
        }),
      }),
    );
  });

  it('should pass through when input is not malicious', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const auditLogger = createMockAuditLogger();
    const inputSanitizer = createMockInputSanitizer({
      detectInjection: vi.fn().mockReturnValue({
        isMalicious: false,
        confidence: 0,
        patterns: [],
        sanitizedInput: '',
      }),
    });
    const ctx = createTestContext(llm, tools, { inputSanitizer, auditLogger });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    // Should pass through
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.event.type === 'llm.response')).toBe(true);
    expect(llm.chat).toHaveBeenCalled();

    // Audit logger should NOT have been called (not malicious)
    expect(auditLogger.append).not.toHaveBeenCalled();
  });

  it('should pass through when inputSanitizer is not configured', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const ctx = createTestContext(llm, tools); // no inputSanitizer
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.event.type === 'llm.response')).toBe(true);
    expect(llm.chat).toHaveBeenCalled();
  });

  it('should handle empty messages gracefully', async () => {
    const llm = createMockLLMAdapter();
    const tools = createMockToolRegistry();
    const inputSanitizer = createMockInputSanitizer();
    const ctx = createTestContext(llm, tools, { inputSanitizer });
    const deps = createTestDeps(ctx);
    const state = createTestState({ messages: [] });

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    // Should not crash — passes through with empty input text
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(inputSanitizer.detectInjection).toHaveBeenCalledWith('');
  });
});

// ============================================================
// Tests: errorClassifier on LLM Error Path
// ============================================================

describe('errorClassifier on LLM error path', () => {
  it('should classify error and record failure on LLM chat error', async () => {
    const llm = createMockLLMAdapter({
      chat: vi.fn().mockRejectedValue(new Error('LLM API Error')),
    });
    const tools = createMockToolRegistry();
    const errorClassifier = createMockErrorClassifier({
      classify: vi.fn().mockReturnValue('severe' as ErrorSeverity),
    });
    const circuitBreaker = createMockCircuitBreaker();
    const ctx = createTestContext(llm, tools, { errorClassifier, circuitBreaker });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    // Should get error + done events
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some(e => e.event.type === 'agent.error')).toBe(true);
    expect(events.some(e => e.event.type === 'done')).toBe(true);

    // Error classifier should have been called
    expect(errorClassifier.classify).toHaveBeenCalled();

    // Circuit breaker should have recorded the failure
    expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('severe');
  });

  it('should NOT crash when errorClassifier throws', async () => {
    const llm = createMockLLMAdapter({
      chat: vi.fn().mockRejectedValue(new Error('LLM API Error')),
    });
    const tools = createMockToolRegistry();
    const errorClassifier = createMockErrorClassifier({
      classify: vi.fn().mockImplementation(() => {
        throw new Error('Classifier crash');
      }),
    });
    const circuitBreaker = createMockCircuitBreaker();
    const ctx = createTestContext(llm, tools, { errorClassifier, circuitBreaker });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    // Should NOT throw — error is caught internally
    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some(e => e.event.type === 'agent.error')).toBe(true);

    // recordFailure should NOT have been called (classifier threw before it)
    expect(circuitBreaker.recordFailure).not.toHaveBeenCalled();
  });

  it('should NOT call errorClassifier when circuitBreaker is missing', async () => {
    const llm = createMockLLMAdapter({
      chat: vi.fn().mockRejectedValue(new Error('LLM API Error')),
    });
    const tools = createMockToolRegistry();
    const errorClassifier = createMockErrorClassifier();
    // No circuitBreaker — errorClassifier should not be called
    const ctx = createTestContext(llm, tools, { errorClassifier });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some(e => e.event.type === 'agent.error')).toBe(true);

    // errorClassifier should NOT have been called (circuitBreaker is missing)
    expect(errorClassifier.classify).not.toHaveBeenCalled();
  });

  it('should NOT call errorClassifier when errorClassifier is missing', async () => {
    const llm = createMockLLMAdapter({
      chat: vi.fn().mockRejectedValue(new Error('LLM API Error')),
    });
    const tools = createMockToolRegistry();
    const circuitBreaker = createMockCircuitBreaker();
    // No errorClassifier
    const ctx = createTestContext(llm, tools, { circuitBreaker });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const events = await firstValueFrom(handleLLMRequest(deps, state).pipe(toArray()));

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some(e => e.event.type === 'agent.error')).toBe(true);

    // recordFailure should NOT have been called (errorClassifier is missing)
    expect(circuitBreaker.recordFailure).not.toHaveBeenCalled();
  });
});

// ============================================================
// Tests: callLLMStreaming error path with errorClassifier
// ============================================================

describe('errorClassifier on streaming LLM error path', () => {
  it('should classify error and record failure on streaming error', async () => {
    const llm = createMockLLMAdapter({
      stream: vi.fn().mockReturnValue(
        new Observable(subscriber => {
          subscriber.error(new Error('Stream error'));
        }),
      ),
    });
    const tools = createMockToolRegistry();
    const errorClassifier = createMockErrorClassifier({
      classify: vi.fn().mockReturnValue('severe' as ErrorSeverity),
    });
    const circuitBreaker = createMockCircuitBreaker();
    const ctx = createTestContext(llm, tools, { errorClassifier, circuitBreaker });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const depsWithStreaming: HandlerDeps = {
      ...deps,
      config: { ...deps.config, streaming: true },
    };

    const events = await firstValueFrom(handleLLMRequest(depsWithStreaming, state).pipe(toArray()));

    // Should get error + done events
    expect(events.some(e => e.event.type === 'agent.error')).toBe(true);
    expect(events.some(e => e.event.type === 'done')).toBe(true);

    // Error classifier should have been called
    expect(errorClassifier.classify).toHaveBeenCalled();

    // Circuit breaker should have recorded the failure
    expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('severe');
  });

  it('should NOT crash when errorClassifier throws on streaming error', async () => {
    const llm = createMockLLMAdapter({
      stream: vi.fn().mockReturnValue(
        new Observable(subscriber => {
          subscriber.error(new Error('Stream error'));
        }),
      ),
    });
    const tools = createMockToolRegistry();
    const errorClassifier = createMockErrorClassifier({
      classify: vi.fn().mockImplementation(() => {
        throw new Error('Classifier crash');
      }),
    });
    const circuitBreaker = createMockCircuitBreaker();
    const ctx = createTestContext(llm, tools, { errorClassifier, circuitBreaker });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const depsWithStreaming: HandlerDeps = {
      ...deps,
      config: { ...deps.config, streaming: true },
    };

    // Should NOT throw
    const events = await firstValueFrom(handleLLMRequest(depsWithStreaming, state).pipe(toArray()));

    expect(events.some(e => e.event.type === 'agent.error')).toBe(true);
    expect(circuitBreaker.recordFailure).not.toHaveBeenCalled();
  });
});
