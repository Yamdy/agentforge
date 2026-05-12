Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Replace the mock LLM provider with real Vercel AI SDK integration. Implement the `invokeLLM` pipeline stage using `streamText` from the AI SDK.

**Model string parsing:** Parse `'provider/model-name'` format (e.g., `'openai/gpt-5'`, `'anthropic/claude-sonnet-4-6'`) and resolve to AI SDK model instances.

**Streaming output:** The `invokeLLM` stage returns an AsyncGenerator of text chunks. The Agent Loop collects the full response while also yielding chunks to external consumers in real-time.

**Token usage extraction:** After the LLM call completes, extract input/output token counts from the AI SDK response and store in PipelineContext.

**Error handling with retry:** Implement exponential backoff retry for transient API errors (rate limits, server errors). Do NOT retry on auth errors or invalid request errors.

**Tool calling protocol:** Parse tool call requests from the AI SDK response. The Agent Loop detects tool calls and iterates. For now, tool calls are detected but execution is deferred to Issue 05.

## Acceptance criteria

- [x] Agent can call a real LLM via Vercel AI SDK using model string notation
- [x] Streaming output is delivered via AsyncGenerator
- [x] Token usage (input/output) is recorded in PipelineContext after each LLM call
- [x] Transient errors retry with exponential backoff (max 3 retries)
- [x] Auth errors and invalid requests do NOT retry
- [x] Tool call requests are parsed from LLM response
- [x] Tests use AI SDK mock provider (no real API calls needed)

## Blocked by

- Issue 02 (Minimal Pipeline + Agent Loop)

## User stories covered

9, 10, 11
