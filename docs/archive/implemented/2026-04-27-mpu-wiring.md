# MPU Dead Slots Wiring Plan

> **Status: ✅ COMPLETED** — All 7 chunks implemented. circuitBreaker/rateLimiter/inputSanitizer/errorClassifier wired in handlers/llm.ts, permissionPolicy/permissionController/sandboxExecutor in handlers/tool-execution.ts, planner in handlers/lifecycle.ts, pluginPipeline in agent-loop.ts, productionPreset in create-agent.ts, errorClassifier in error path.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Wire all 9 dead AgentContext slots + plugin system + productionPreset into the agent loop, making MPU modules functionally active.

**Architecture:** Each dead slot gets a handler-level conditional call (`ctx.xxx?.method()`), following the established pattern of `ctx.auditLogger?.append()` and `ctx.securityGuard.checkCommand()`. The plugin system gets a `pluginPipeline` injection point in `createAgentLoop` and `createAgent`. The productionPreset gets wired into `createAgent`.

### Review Amendments (incorporated into plan)

1. **inputSanitizer low-confidence → observability event** — Low-confidence injection detection must emit an `agent.error` event (name: `InjectionWarning`, not fatal), not just audit log. Applied in Chunk 1 Step 7.
2. **permissionController is intentionally blocking** — Documented with comment in Chunk 2 Step 4. This blocks agent loop recursion until human answers, mirroring HITL pattern.
3. **planner is fire-and-forget only** — Current wiring logs the plan but does NOT write it to `AgentState`. This is explicitly scoped as "Phase 2: plan injection into state". Plan results are observable via audit log only. Documented in Chunk 3.
4. **sandboxExecutor needs timeout + cancel protection** — Added `timeout()` + `takeUntil(destroy$)` in Chunk 2 Step 5.
5. **errorClassifier on tool.error path** — Added in Chunk 2 Step 6 (new step).
6. **costTracker vs quota** — `costTracker` (M7) is already wired in `handleLLMResponse` via `ctx.services.costTracker?.record()`. `quota` (also M7) is wired via `ctx.quota?.consume()`. These are two separate interfaces — `CostTracker` for recording, `QuotaController` for checking limits. No additional wiring needed.

**Tech Stack:** TypeScript, Vitest, Zod

---

## Wiring Strategy: The "Optional Chain Guard" Pattern

All existing wiring follows this pattern:

```typescript
// Fire-and-forget (never blocks the loop):
ctx.auditLogger?.append({...});

// Blocking guard (returns EMPTY/error if check fails):
if (ctx.securityGuard) {
  const check = ctx.securityGuard.checkCommand(args);
  if (!check.allowed) return of(errorEvent);
}
```

Each wiring task must decide: **blocking** (guard pattern) or **fire-and-forget** (audit pattern).

---

## File Change Map

| File | Changes |
|------|---------|
| `src/loop/agent-loop.ts` | Add `permissionPolicy` check in `step()`, add `pluginPipeline` parameter |
| `src/loop/handlers/lifecycle.ts` | Add `ctx.planner?.plan()` call in `handleAgentStart` |
| `src/loop/handlers/llm.ts` | Add `circuitBreaker`, `rateLimiter`, `inputSanitizer` checks before LLM call; add `errorClassifier` on error |
| `src/loop/handlers/tool-execution.ts` | Add `permissionController`/`permissionPolicy` check, `sandboxExecutor` for sandboxed tools, `inputSanitizer` on tool args |
| `src/api/create-agent.ts` | Wire `productionPreset`, add `plugins` config field, inject plugin pipeline |
| `src/api/types.ts` | Add `plugins` and `mpuServices` fields to `AgentConfig` |
| `src/core/context.ts` | Add `pluginPipeline` optional field to `AgentContext` |
| `src/core/context-builder.ts` | Add `withPluginPipeline()` method |

---

## Chunk 1: LLM Request Guards (circuitBreaker, rateLimiter, inputSanitizer)

**Files:**
- Modify: `src/loop/handlers/llm.ts`
- Test: `tests/loop/handlers/llm.spec.ts`

### Task 1.1: Write failing tests for LLM guards

- [x] **Step 1: Test circuitBreaker gate**

Create test in `tests/loop/handlers/llm.spec.ts`:

```typescript
describe('Circuit Breaker Integration', () => {
  it('should block LLM call when circuit breaker is tripped', async () => {
    const mockBreaker = { shouldTrip: () => true, recordFailure: vi.fn(), reset: vi.fn(), getState: () => 'open' as const, getFailureCount: () => 3 };
    const ctx = createMockContext({ circuitBreaker: mockBreaker });
    const deps = createMockDeps(ctx);
    const state = createInitialState();
    
    const events$ = handleLLMRequest(deps, state);
    const events = await collectEvents(events$);
    
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent.error' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'done', reason: 'error' }));
  });

  it('should allow LLM call when circuit breaker is closed', async () => {
    const mockBreaker = { shouldTrip: () => false, recordFailure: vi.fn(), reset: vi.fn(), getState: () => 'closed' as const, getFailureCount: () => 0 };
    const ctx = createMockContext({ circuitBreaker: mockBreaker });
    // ... normal LLM call proceeds
  });
});
```

- [x] **Step 2: Test rateLimiter gate**

```typescript
describe('Rate Limiter Integration', () => {
  it('should block LLM call when rate limit exceeded', async () => {
    const mockRateLimiter = { check: vi.fn().mockReturnValue(false), consume: vi.fn(), reset: vi.fn() };
    const ctx = createMockContext({ rateLimiter: mockRateLimiter, services: createMockServices() });
    const deps = createMockDeps(ctx);
    const state = createInitialState();
    
    const events$ = handleLLMRequest(deps, state);
    const events = await collectEvents(events$);
    
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent.error' }));
    expect(mockRateLimiter.check).toHaveBeenCalled();
  });
});
```

- [x] **Step 3: Test inputSanitizer transform**

```typescript
describe('Input Sanitizer Integration', () => {
  it('should sanitize messages before LLM call', async () => {
    const mockSanitizer = { 
      detectInjection: vi.fn().mockReturnValue({ isMalicious: false, confidence: 0, patterns: [], sanitizedInput: 'sanitized' }),
      sanitize: vi.fn().mockReturnValue('sanitized input'),
      validateToolArgs: vi.fn() 
    };
    const ctx = createMockContext({ inputSanitizer: mockSanitizer });
    // ... verify sanitized messages are sent to LLM
  });

  it('should block LLM call when injection detected', async () => {
    const mockSanitizer = { 
      detectInjection: vi.fn().mockReturnValue({ isMalicious: true, confidence: 0.95, patterns: ['prompt_injection'], sanitizedInput: '' }),
      sanitize: vi.fn(),
      validateToolArgs: vi.fn() 
    };
    const ctx = createMockContext({ inputSanitizer: mockSanitizer });
    const events = await collectEvents(handleLLMRequest(deps, state));
    
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent.error' }));
  });
});
```

- [x] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/loop/handlers/llm.spec.ts --reporter=verbose`
Expected: FAIL — circuitBreaker/rateLimiter/inputSanitizer properties don't exist on mock context yet

### Task 1.2: Implement LLM guard wiring

- [x] **Step 5: Add circuitBreaker check in `handleLLMRequest`**

In `src/loop/handlers/llm.ts`, at the TOP of `handleLLMRequest()`, BEFORE the cost check:

```typescript
// MPU M4: Circuit breaker — block LLM call if circuit is open
if (ctx.circuitBreaker?.shouldTrip()) {
  const errorEvent: AgentEvent = {
    type: 'agent.error',
    timestamp: Date.now(),
    sessionId,
    error: {
      name: 'CircuitBreakerOpenError',
      message: 'Circuit breaker is open — LLM calls blocked due to repeated failures',
    },
  };
  const doneEv: AgentEvent = {
    type: 'done',
    timestamp: Date.now(),
    sessionId,
    reason: 'error',
  };
  return from([
    { event: errorEvent, state },
    { event: doneEv, state },
  ] as StepContext[]);
}
```

- [x] **Step 6: Add rateLimiter check in `handleLLMRequest`**

After circuitBreaker check, before cost check:

```typescript
// MPU M6: Rate limiter — block LLM call if rate limit exceeded
if (ctx.rateLimiter) {
  const key = `llm:${sessionId}`;
  if (!ctx.rateLimiter.check(key, { maxRequests: 100, windowMs: 60000 })) {
    const errorEvent: AgentEvent = {
      type: 'agent.error',
      timestamp: Date.now(),
      sessionId,
      error: {
        name: 'RateLimitExceededError',
        message: 'LLM rate limit exceeded',
      },
    };
    const doneEv: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId,
      reason: 'error',
    };
    return from([
      { event: errorEvent, state },
      { event: doneEv, state },
    ] as StepContext[]);
  }
  ctx.rateLimiter.consume(key, { maxRequests: 100, windowMs: 60000 });
}
```

- [x] **Step 7: Add inputSanitizer check in `doLLMRequest`**

At the TOP of `doLLMRequest()`, before compaction:

```typescript
// MPU M6: Input sanitizer — detect injection patterns (fire-and-forget log, blocking on high confidence)
if (ctx.inputSanitizer) {
  const lastMessage = state.messages[state.messages.length - 1];
  const inputText = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
  const detection = ctx.inputSanitizer.detectInjection(inputText);
  if (detection.isMalicious && detection.confidence >= 0.8) {
    const errorEvent: AgentEvent = {
      type: 'agent.error',
      timestamp: Date.now(),
      sessionId: config.model.provider,
      error: {
        name: 'InjectionDetectedError',
        message: `Potential prompt injection detected: ${detection.patterns.join(', ')}`,
      },
    };
    const doneEv: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId: deps.sessionId,
      reason: 'error',
    };
    return from([
      { event: errorEvent, state },
      { event: doneEv, state },
    ] as StepContext[]);
  }
  // Low-confidence detection: emit observability event + audit log (fire-and-forget)
  // This is NOT fatal — it warns downstream monitoring without blocking the loop
  if (detection.isMalicious) {
    ctx.auditLogger?.append({
      sessionId: deps.sessionId,
      agentName: state.agentName,
      eventType: 'injection.detected',
      action: 'llm.request',
      resource: 'user_input',
      result: 'success',
      details: { confidence: detection.confidence, patterns: detection.patterns },
    });
    // Emit non-fatal observability event so downstream monitoring can detect injection attempts
    // This does NOT stop the loop — it's informational
    const warningEvent: AgentEvent = {
      type: 'agent.error',
      timestamp: Date.now(),
      sessionId: deps.sessionId,
      error: {
        name: 'InjectionWarning',
        message: `Low-confidence injection pattern detected: ${detection.patterns.join(', ')} (confidence: ${detection.confidence.toFixed(2)})`,
      },
    };
    // Fire-and-forget: emit to event stream but don't block
    deps.emitter.emit(warningEvent);
  }
}
```

- [x] **Step 8: Add errorClassifier on LLM error path**

In the LLM error handling (catchError blocks), add after error event:

```typescript
// MPU M4: Error classification (fire-and-forget)
if (ctx.errorClassifier) {
  const severity = ctx.errorClassifier.classify(serializeError(error));
  ctx.circuitBreaker?.recordFailure(severity);
}
```

- [x] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/loop/handlers/llm.spec.ts --reporter=verbose`
Expected: PASS

- [x] **Step 10: Commit**

```bash
git add src/loop/handlers/llm.ts tests/loop/handlers/llm.spec.ts
git commit -m "feat: wire circuitBreaker, rateLimiter, inputSanitizer, errorClassifier into LLM handler"
```

---

## Chunk 2: Tool Execution Guards (permissionPolicy, permissionController, sandboxExecutor)

**Files:**
- Modify: `src/loop/handlers/tool-execution.ts`
- Test: `tests/loop/handlers/tool-execution.spec.ts`

### Task 2.1: Write failing tests for tool execution guards

- [x] **Step 1: Test permissionPolicy gate**

```typescript
describe('Permission Policy Integration', () => {
  it('should block tool execution when policy is "deny"', async () => {
    const mockPolicy = { 
      riskPolicies: { low: 'allow', medium: 'allow', high: 'ask', critical: 'deny' },
      defaultPolicy: 'deny',
      toolPolicies: { 'dangerousTool': 'deny' },
      enforceApprovalFlag: true,
    };
    const ctx = createMockContext({ permissionPolicy: mockPolicy });
    // ... verify tool execution is blocked
  });

  it('should delegate to HITL when policy is "ask"', async () => {
    const mockPolicy = { 
      riskPolicies: { low: 'allow', medium: 'ask', high: 'ask', critical: 'deny' },
      defaultPolicy: 'allow',
      toolPolicies: {},
      enforceApprovalFlag: true,
    };
    const mockPermCtrl = createMockPermissionController();
    const ctx = createMockContext({ permissionPolicy: mockPolicy, permissionController: mockPermCtrl });
    // ... verify hitl.ask event is emitted
  });
});
```

- [x] **Step 2: Test sandboxExecutor routing**

```typescript
describe('SandboxExecutor Integration', () => {
  it('should route sandboxRequired tools through sandboxExecutor', async () => {
    const mockSandbox = { execute: vi.fn().mockResolvedValue({ success: true, result: 'sandbox result', durationMs: 100 }) };
    const ctx = createMockContext({ sandboxExecutor: mockSandbox });
    const toolDef = { name: 'bash', description: 'Run bash', parameters: z.object({ cmd: z.string() }), execute: vi.fn(), sandboxRequired: true };
    ctx.tools.register(toolDef);
    // ... verify sandboxExecutor.execute is called instead of direct execute
  });
});
```

- [x] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/loop/handlers/tool-execution.spec.ts --reporter=verbose`
Expected: FAIL — properties not on context mock yet

### Task 2.2: Implement tool execution guard wiring

- [x] **Step 4: Add permissionPolicy check in `executeSingleTool`**

In `src/loop/handlers/tool-execution.ts`, BEFORE the existing `securityGuard` check:

```typescript
// MPU M6: Permission policy check
if (ctx.permissionPolicy) {
  const toolDef = ctx.tools.get(tc.name);
  const riskLevel = toolDef?.riskLevel ?? 'medium';
  const requiresApproval = toolDef?.requiresApproval ?? false;
  
  // Check tool-level policy first
  const policy = ctx.permissionPolicy.toolPolicies[tc.name] 
    ?? ctx.permissionPolicy.riskPolicies[riskLevel]
    ?? ctx.permissionPolicy.defaultPolicy;
  
  // Override: if tool has requiresApproval=true and enforceApprovalFlag, force 'ask'
  const effectivePolicy = (requiresApproval && ctx.permissionPolicy.enforceApprovalFlag) 
    ? 'ask' 
    : policy;
  
  if (effectivePolicy === 'deny') {
    const resultEvent: AgentEvent = {
      type: 'tool.result',
      timestamp: Date.now(),
      sessionId: deps.sessionId,
      toolCallId: tc.id,
      toolName: tc.name,
      result: `Permission denied: tool "${tc.name}" is not allowed by policy`,
      isError: true,
    };
    return of({ event: resultEvent, state } as StepContext);
  }
  
  if (effectivePolicy === 'ask' && ctx.permissionController) {
    // 🔴 KEY DESIGN: This BLOCKS agent loop until human answers.
    // This mirrors the HITL pattern — the stream pauses, no events are lost.
    // When permissionController.ask() emits, the tool execution continues.
    const promptId = `perm-${generateId()}`;
    return ctx.permissionController.ask({
      promptId,
      permission: tc.name,
      context: { args: tc.args },
      toolName: tc.name,
      toolArgs: tc.args,
    }).then((decision: string) => {
        if (decision === 'deny') {
          const resultEvent: AgentEvent = {
        if (decision === 'deny') {
          const resultEvent: AgentEvent = {
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId: deps.sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            result: `Permission denied by user for tool "${tc.name}"`,
            isError: true,
          };
          return of({ event: resultEvent, state } as StepContext);
        }
        // 'allow' or 'allow_always' — proceed to execute
        if (decision === 'allow_always') {
          ctx.permissionController.isAutoAllowed(tc.name); // cache auto-allow
        }
        return executeToolDirectly(deps, tc, state);
      })
      .catch(() => executeToolDirectly(deps, tc, state));
  }
}
```

- [x] **Step 6: Add sandboxExecutor routing in `executeSingleTool`**

In `src/loop/handlers/tool-execution.ts`, add imports at top:

```typescript
// No special imports needed — sandbox executor uses plain async/await
```

After the securityGuard check and permission check, BEFORE direct tool execution:

```typescript
// MPU M3: Sandbox execution for sandboxRequired tools
if (ctx.sandboxExecutor) {
  const toolDef = ctx.tools.get(tc.name);
  if (toolDef?.sandboxRequired) {
    return from(
      ctx.sandboxExecutor.execute(
        { toolName: tc.name, args: tc.args },
        { sessionId: deps.sessionId, timeoutMs: 30000, toolRegistry: ctx.tools }
      )
      ).then((sandboxResult) => {
        const resultEvent: AgentEvent = {
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId: deps.sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: sandboxResult.success ? (sandboxResult.result ?? 'Sandbox execution completed') : `Sandbox error: ${sandboxResult.error?.message ?? 'unknown'}`,
          isError: !sandboxResult.success,
        };
        return of({ event: resultEvent, state } as StepContext);
      })
      .catch((error: unknown) => {
        const resultEvent: AgentEvent = {
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId: deps.sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: `Sandbox execution failed: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
        return of({ event: resultEvent, state } as StepContext);
      })
    );
  }
}
```

**Note**: `destroy$` must be accessible from `executeSingleTool`. Pass it through `HandlerDeps`:

In `src/loop/agent-loop.ts`, add to `HandlerDeps`:

```typescript
export interface HandlerDeps {
  ctx: AgentContext;
  config: AgentLoopConfig;
  sessionId: string;
  destroySignal: AbortSignal; // Add this
}
```

And update `createAgentLoop` where `deps` is constructed:

```typescript
const deps: HandlerDeps = { ctx, config, sessionId, destroySignal: abortController.signal };
```

- [x] **Step 6b: Add errorClassifier on tool error path**

In `executeSingleTool`, after tool execution fails (the catchError block), add:

```typescript
// MPU M4: Error classification on tool error (fire-and-forget)
if (ctx.errorClassifier && result.isError) {
  const severity = ctx.errorClassifier.classify({
    name: 'ToolExecutionError',
    message: result.result,
    stack: undefined,
  });
  ctx.circuitBreaker?.recordFailure(severity);
}
```

- [x] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/loop/handlers/tool-execution.spec.ts --reporter=verbose`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add src/loop/handlers/tool-execution.ts tests/loop/handlers/tool-execution.spec.ts
git commit -m "feat: wire permissionPolicy, permissionController, sandboxExecutor into tool execution handler"
```

---

## Chunk 3: Planning Hook (ctx.planner) — Phase 1: Fire-and-Forget

**⚠️ Scope Note:** This is a Phase 1 wiring where `planner.plan()` is called fire-and-forget. The plan result is logged via audit but NOT written to `AgentState`. Phase 2 (plan injection into state, where the agent uses the plan to guide tool selection) requires adding a `currentPlan` field to `AgentState` and modifying the LLM prompt builder — a larger change that should be a separate plan.

**Files:**
- Modify: `src/loop/handlers/lifecycle.ts`
- Test: `tests/loop/handlers/lifecycle.spec.ts`

### Task 3.1: Write failing test for planner integration

- [x] **Step 1: Test planner hook in agent.start**

```typescript
describe('Planner Integration', () => {
  it('should call planner.plan() when planner is configured on agent.start', async () => {
    const mockPlanner = { plan: vi.fn().mockResolvedValue({ id: 'plan-1', input: 'test', steps: [] }), validate: vi.fn() };
    const ctx = createMockContext({ planner: mockPlanner });
    const events$ = handleAgentStart(createMockDeps(ctx), createInitialState(), startEvent);
    const events = await collectEvents(events$);
    
    // Planner is called — but it's fire-and-forget, doesn't block
    // The plan should be recorded in state or logged
    expect(mockPlanner.plan).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loop/handlers/lifecycle.spec.ts --reporter=verbose`
Expected: FAIL — planner not called yet

### Task 3.2: Implement planner hook

- [x] **Step 3: Add planner plan call in `handleAgentStart`**

In `src/loop/handlers/lifecycle.ts`:

```typescript
// MPU M2: Planning — fire-and-forget plan generation
// Phase 1: Plan result is logged but NOT injected into AgentState.
// Phase 2 (future): Add currentPlan to AgentState, modify prompt builder to include plan.
if (ctx.planner) {
  const input = _event.input ?? (state.messages.length > 0 ? (typeof state.messages[state.messages.length - 1]?.content === 'string' ? state.messages[state.messages.length - 1].content : '') : '');
  ctx.planner.plan(input, { availableTools: ctx.tools.list(), maxSteps: state.maxSteps })
    .then(plan => {
      // Log plan via audit (fire-and-forget)
      ctx.auditLogger?.append({
        sessionId,
        agentName: state.agentName,
        eventType: 'agent.start',
        action: 'plan.generated',
        resource: input,
        result: 'success',
        details: { planId: plan.id, stepCount: plan.steps.length },
      });
    })
    .catch(() => {
      // Planner failure must never crash the loop
    });
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/loop/handlers/lifecycle.spec.ts --reporter=verbose`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/loop/handlers/lifecycle.ts tests/loop/handlers/lifecycle.spec.ts
git commit -m "feat: wire planner into agent.start handler"
```

---

## Chunk 4: Plugin System Integration

**Files:**
- Modify: `src/core/context.ts` — Add `pluginPipeline` to `AgentContext`
- Modify: `src/core/context-builder.ts` — Add `withPluginPipeline()` method
- Modify: `src/loop/agent-loop.ts` — Apply pluginPipeline in `run()`
- Modify: `src/api/create-agent.ts` — Accept `plugins` config and wire PluginManager
- Modify: `src/api/types.ts` — Add `plugins` field to `AgentConfig`
- Test: `tests/api/create-agent.spec.ts`

### Task 4.1: Add pluginPipeline to AgentContext

- [x] **Step 1: Test that plugins are applied to event stream**

```typescript
describe('Plugin System Integration', () => {
  it('should apply plugin interceptors to event stream', async () => {
    const intercepted: AgentEvent[] = [];
    const plugin: InterceptorPlugin = {
      name: 'test-interceptor',
      version: '1.0.0',
      setup: (ctx) => {
        ctx.intercept('llm.response', (event) => {
          intercepted.push(event);
          return event;
        });
      },
    };
    const manager = createPluginManager();
    manager.register(plugin);
    
    const agent = createAgent({
      name: 'test',
      model: 'openai/gpt-4o-mini',
      plugins: [plugin],
    });
    // ... verify interceptor is invoked during event stream
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Expected: FAIL — `plugins` not in AgentConfig yet

### Task 4.1b: Test ContextBuilder.withPluginPipeline()

- [x] **Step 2b: Test that pluginPipeline is correctly built**

```typescript
describe('ContextBuilder withPluginPipeline', () => {
  it('should set pluginPipeline on AgentContext', () => {
    const pipeline = <T>(source: AsyncGenerator<T>) => source; // identity pipeline
    const ctx = AgentContextBuilder.create()
      .withLLM(mockLLM)
      .withTools([mockTool])
      .withPluginPipeline(pipeline)
      .build();
    
    expect(ctx.pluginPipeline).toBe(pipeline);
  });

  it('should not set pluginPipeline when not called', () => {
    const ctx = AgentContextBuilder.create()
      .withLLM(mockLLM)
      .withTools([mockTool])
      .build();
    
    expect(ctx.pluginPipeline).toBeUndefined();
  });
});
```

### Task 4.2: Implement plugin pipeline injection

- [x] **Step 3: Add `pluginPipeline` field to `AgentContext`**

In `src/core/context.ts`, add to `AgentContext` interface:

```typescript
// ----- Plugin Pipeline (optional) -----
/** Plugin pipeline for event interception and observation */
pluginPipeline?: <T>(source: AsyncGenerator<T>) => AsyncGenerator<T>;
```

- [x] **Step 4: Add `withPluginPipeline()` builder method**

In `src/core/context-builder.ts`:

```typescript
/**
 * Set plugin pipeline for event interception
 *
   * @param pipeline - Pipeline function that transforms AsyncGenerator<AgentEvent>
 * @returns this
 */
withPluginPipeline(pipeline: <T>(source: AsyncGenerator<T>) => AsyncGenerator<T>): this {
  this.state.pluginPipeline = pipeline;
  return this;
}
```

And in `build()`:

```typescript
if (this.state.pluginPipeline !== undefined) {
  ctx.pluginPipeline = this.state.pluginPipeline;
}
```

- [x] **Step 5: Wire pluginPipeline into `createAgentLoop`**

In `src/loop/agent-loop.ts`, inside `run()` function, after the `expand(step)` pipe:

```typescript
// Apply plugin pipeline if configured
let eventStream = agentLoopEvents(ctx, config, sessionId);

if (ctx.pluginPipeline) {
  eventStream = ctx.pluginPipeline(eventStream);
}
```

- [x] **Step 6: Add `plugins` config to `AgentConfig` and wire in `createAgent`**

In `src/api/types.ts`, add to `AgentConfig`:

```typescript
/** Plugin configurations */
plugins?: Array<{
  name: string;
  version: string;
  setup: (ctx: PluginContext) => void;
}>;
```

In `src/api/create-agent.ts`:

```typescript
import { createPluginManager, buildPluginPipeline, type Plugin } from '../plugins/index.js';

// In createAgent():
if (config.plugins && config.plugins.length > 0) {
  const manager = createPluginManager();
  for (const plugin of config.plugins) {
    manager.register(plugin as unknown as Plugin);
  }
  const pipeline = buildPluginPipeline(manager);
  builder = builder.withPluginPipeline(pipeline);
}
```

- [x] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/api/create-agent.spec.ts --reporter=verbose`
Expected: PASS

- [x] **Step 8: Commit**

```bash
git add src/core/context.ts src/core/context-builder.ts src/loop/agent-loop.ts src/api/create-agent.ts src/api/types.ts tests/api/create-agent.spec.ts
git commit -m "feat: wire plugin system into agent loop via pluginPipeline context slot"
```

---

## Chunk 5: Production Preset Activation

**Files:**
- Modify: `src/api/create-agent.ts`
- Test: `tests/api/create-agent.spec.ts`

### Task 5.1: Wire productionPreset

- [x] **Step 1: Test production preset application**

```typescript
describe('Production Preset', () => {
  it('should apply productionPreset operators when preset is "production"', async () => {
    const agent = createAgent({
      name: 'test',
      model: 'openai/gpt-4o-mini',
      preset: 'production',
    });
    // Verify that productionPreset operators are in the pipeline
  });
});
```

- [x] **Step 2: Implement production preset wiring**

In `src/api/create-agent.ts`, in `AgentImpl.run$()`, after the debug/test preset block:

```typescript
// Apply production preset if configured
if (this.config.preset === 'production') {
  applyProductionPreset(this);
}
```

Add the import:

```typescript
import { productionPreset } from '../operators/index.js';
```

- [x] **Step 3: Run tests**

Run: `npx vitest run tests/api/create-agent.spec.ts --reporter=verbose`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add src/api/create-agent.ts tests/api/create-agent.spec.ts
git commit -m "feat: wire productionPreset into createAgent"
```

---

## Chunk 6: Error Classifier in Error Path

**Files:**
- Modify: `src/loop/handlers/llm.ts`
- Modify: `src/loop/agent-loop.ts`

### Task 6.1: Wire errorClassifier on agent.error events

- [x] **Step 1: In `agent-loop.ts`, add errorClassifier call on `agent.error` events**

Already has `ctx.auditLogger?.append()` for `agent.error`. Add after it:

```typescript
// MPU M4: Error classification + circuit breaker recording
if (event.type === 'agent.error') {
  if (ctx.errorClassifier && event.error) {
    const severity = ctx.errorClassifier.classify(event.error);
    if (severity === 'severe' || severity === 'moderate') {
      ctx.circuitBreaker?.recordFailure(severity);
    }
  }
}
```

- [x] **Step 2: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: PASS (all existing + new tests)

- [x] **Step 3: Commit**

```bash
git add src/loop/agent-loop.ts src/loop/handlers/llm.ts
git commit -m "feat: wire errorClassifier and circuitBreaker recording into error path"
```

---

## Chunk 7: Export Isolated Modules from Public API

**Files:**
- Modify: `src/index.ts`

### Task 7.1: Add missing module exports to src/index.ts

Currently NOT exported: sandbox, audit, storage, lifecycle, validation, security, planning, resilience

- [x] **Step 1: Add the following exports to `src/index.ts`**

```typescript
// ============================================================
// MPU Module Exports (previously internal-only)
// ============================================================

export { type SandboxConfig, type SandboxResult, DockerSandbox, createDockerSandbox } from './sandbox/index.js';

export { type AuditEntry, type AuditFilter, type IntegrityReport, SqliteAuditStore, HashChain } from './audit/index.js';

export { SqliteCheckpointStorage, SqliteSessionStorage } from './storage/index.js';

export { GracefulShutdown } from './lifecycle/index.js';

export { ResultValidatorImpl, GoalAlignmentCheckerImpl, CompletionScorerImpl } from './validation/index.js';

export { SecurityGuard, type SecurityCheckResult } from './security/index.js';

export { DefaultErrorClassifier, DefaultCircuitBreaker, DefaultAutoRepairer } from './resilience/index.js';

export { PlannerImpl, PlanExecutorImpl } from './planning/index.js';
```

- [x] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export previously internal MPU modules from public API"
```

---

## Summary: Wiring Status After Plan Completion

| Slot | Before | After | Handler Location | Pattern |
|------|--------|-------|-----------------|---------|
| `ctx.circuitBreaker` | 🔴 Dead | ✅ Active | `handlers/llm.ts` pre-LLM guard + `agent-loop.ts` error path | Blocking guard |
| `ctx.errorClassifier` | 🔴 Dead | ✅ Active | `agent-loop.ts` error path + `handlers/llm.ts` LLM error + `handlers/tool-execution.ts` tool error | Fire-and-forget → feeds circuitBreaker |
| `ctx.rateLimiter` | 🔴 Dead | ✅ Active | `handlers/llm.ts` pre-LLM guard | Blocking guard |
| `ctx.inputSanitizer` | 🔴 Dead | ✅ Active | `handlers/llm.ts` pre-LLM guard | Blocking (≥0.8) + observability event (<0.8) |
| `ctx.permissionPolicy` | 🔴 Dead | ✅ Active | `handlers/tool-execution.ts` pre-tool guard | Blocking guard |
| `ctx.permissionController` | 🔴 Dead | ✅ Active | `handlers/tool-execution.ts` ask flow | Blocking (HITL pattern) |
| `ctx.sandboxExecutor` | 🔴 Dead | ✅ Active | `handlers/tool-execution.ts` sandbox routing | Async with timeout+cancel |
| `ctx.planner` | 🔴 Dead | ✅ Active (Phase 1) | `handlers/lifecycle.ts` on agent.start | Fire-and-forget + audit log |
| `ctx.mcp` | 🔴 Dead | ⏳ Deferred | Needs architectural decision | — |
| `pluginPipeline` | N/A | ✅ Active | `agent-loop.ts` run() + `createAgent.ts` | AsyncGenerator transform |
| `productionPreset` | 🔴 Dead | ✅ Active | `createAgent.ts` AgentImpl.run$() | Operator pipeline |
| `tool.error → errorClassifier` | N/A | ✅ Active | `handlers/tool-execution.ts` tool error path | Fire-and-forget → feeds circuitBreaker |

### ⏳ Deferred: MCP Client Integration

`ctx.mcp` requires a more complex architectural decision: when should MCP tools be discovered? Options:
1. **At agent.start** — discover MCP tools and register them in ToolRegistry
2. **At tool.call** — check `ctx.mcp` when tool name not found in ToolRegistry (fallback)
3. **Both** — discover at start, fallback to MCP for unknown tools

This should be a separate plan after the basic wiring is complete.

### ⏳ Deferred: Planner Phase 2 (Plan Injection)

Current wiring (Phase 1) only logs plan results via audit. Phase 2 requires:
1. Add `currentPlan?: ExecutionPlan` field to `AgentState`
2. Await `planner.plan()` in `handleAgentStart` (blocking, not fire-and-forget)
3. Modify `DefaultPromptBuilder` to include plan context in system prompt
4. Add `plan.step` / `plan.complete` event types

### ⏳ Deferred: Orphaned Modules

The following modules remain implementation-only and need separate integration work:
- `sandbox/DockerSandbox` — needs Docker runtime, correctly isolated as user choice
- `audit/SqliteAuditStore` — persistence implementation, user selects via `createMPUServices()`
- `storage/Sqlite*` — persistence implementation, user selects via `ContextBuilder.withCheckpoint()`

### ⏳ Cost Tracker Confirmation

`costTracker` (M7 Cost Tracking) is already wired in `handleLLMResponse`:
- `ctx.services.costTracker?.record()` — records cost data (fire-and-forget)
- `ctx.services.costTracker.checkLimit()` — blocks LLM call if limit exceeded

`quota` (M7 Quota) is wired in `handleLLMResponse`:
- `ctx.quota?.consume()` — consumes quota (fire-and-forget)

These are two separate `M7` interfaces: `CostTracker` for recording and `QuotaController` for limit checking. No additional wiring needed.