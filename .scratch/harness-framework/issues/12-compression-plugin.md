Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the CompressionProcessor plugin with multi-phase compression and token-aware triggering.

**Compression phases:**
```typescript
type CompressionPhase =
  | { type: 'truncate'; maxLength: number }
  | { type: 'summarize'; model: string; maxTokens: number }
  | { type: 'prune'; keepRecent: number };

interface CompressionConfig {
  maxContextTokens: number;
  phases: CompressionPhase[];
}
```

**CompressionProcessor at prepareStep:**
1. Estimate tokens in `session.messageHistory`
2. If over threshold, apply phases in order
3. `truncate`: Truncate long tool outputs to maxLength
4. `summarize`: Send old messages to LLM, replace with summary, keep recent N
5. `prune`: Remove oldest messages, keep recent N

**Tool result eviction (from DeepAgents insight):** [DONE] Built-in `tool.wrap` Hook that checks output size. When over threshold, offloads to storage and replaces with preview + reference. Separate from CompressionProcessor but complementary.

## Acceptance criteria

- [x] Truncate phase truncates tool outputs longer than threshold
- [x] Prune phase removes oldest messages, keeping recent N
- [x] Summarize phase triggers only when truncate/prune insufficient
- [x] Summarize replaces old messages with single summary
- [x] CompressionProcessor registered at prepareStep stage
- [x] Compression metrics recorded in span attributes
- [x] Test: long conversation triggers compression, token count drops

## Blocked by

- Issue 07 (Plugin System)
- Issue 11 (Memory Plugin)
- Plan A (Foundation — IterationState, HookRunner)

## User stories covered

35, 36, 37
