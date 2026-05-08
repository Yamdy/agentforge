Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the CompressionProcessor plugin that prevents context rot via two-phase compression: micro-compression first, then LLM summarization as fallback.

**CompressionProcessor at evaluateIteration:** Runs when context approaches the token limit:
1. **Estimate tokens** — count approximate tokens in current message history
2. **Phase 1: Micro-compression** (cheap, no LLM call)
   - Truncate long tool outputs to configurable max length
   - Remove duplicate/consecutive system reminders
   - Remove old tool results that have been summarized already
3. **Phase 2: LLM summarization** (expensive, requires LLM call)
   - If micro-compression didn't free enough tokens
   - Send old messages to LLM with a summarization prompt
   - Replace old messages with a single summary message
   - Keep the most recent N messages intact

**Compression events:** Record compression metrics in the evaluateIteration span attributes:
- `tokens_before`, `tokens_after`
- `strategy_used` (micro, summarization, both)
- `messages_removed`, `messages_kept`

**Configuration:** Token threshold (when to trigger), max tool output length, summarization model (can differ from agent model), messages to keep intact.

## Acceptance criteria

- [ ] Micro-compression truncates tool outputs longer than configured threshold
- [ ] Micro-compression removes duplicate system reminders
- [ ] LLM summarization is triggered only when micro-compression is insufficient
- [ ] Summarization replaces old messages with a single summary, keeping recent messages intact
- [ ] Compression metrics are recorded in span attributes
- [ ] Test: long conversation triggers micro-compression, verify token count drops
- [ ] Test: very long conversation triggers LLM summarization, verify old messages are summarized

## Blocked by

- Issue 07 (Plugin System)
- Issue 11 (Memory Plugin)

## User stories covered

35, 36, 37
