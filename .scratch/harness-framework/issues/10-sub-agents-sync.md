Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement synchronous sub-agents as tools with isolated context and summary-only return.

**Sub-agent config:**
```typescript
interface SubAgentConfig {
  name: string;
  model?: string;                    // inherits parent if omitted
  systemPrompt?: string;
  tools?: ToolDefinition[];          // inherits parent if omitted
  maxIterations?: number;
  contextPolicy: 'isolated' | 'inherit' | 'summary-only';
}
```

**Sub-agent result:**
```typescript
interface SubAgentResult {
  response: string;
  tokenUsage: TokenUsage;
  sessionId: string;
}
```

**Factory function:** `createSubAgentTool(config: SubAgentConfig): ToolDefinition` — creates a tool that spawns a child Agent, runs it, and returns the result.

**Context policies:**
- `isolated`: Fresh PipelineContext, no parent state
- `inherit`: Receives parent session.messageHistory
- `summary-only`: Receives a summary of parent context

**EventBus integration:** Sub-agents emit `task:start` / `task:end` events. Parent session records associations via session persistence.

**Observability:** Sub-agent execution creates nested spans under the parent's tool_execution span.

## Acceptance criteria

- [ ] Main agent delegates to sub-agent via tool call
- [ ] `isolated` policy: sub-agent runs with fresh context, no state leakage
- [ ] `inherit` policy: sub-agent receives parent message history
- [ ] `summary-only` policy: sub-agent receives compressed parent context
- [ ] Only summary string is returned to parent agent
- [ ] `task:start` / `task:end` events emitted via EventBus
- [ ] Sub-agent errors caught and returned as error summaries
- [ ] Test: main agent delegates task, sub-agent processes, parent receives summary

## Blocked by

- Plan A (Foundation)
- Issue 07 (Plugin System — enhanced HarnessAPI)

## User stories covered

27, 29, 30
