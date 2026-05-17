# LLMInvoker Extraction and Unified Streaming Path

We extract LLM invocation into a dedicated `LLMInvoker` module and unify `Agent.run()` and `Agent.stream()` through a single pipeline path. Previously, `Agent.stream()` bypassed the pipeline entirely — no Processors, no observability spans, no tools, no retry.

## LLMInvoker

`LLMInvoker` wraps the Vercel AI SDK's `streamText` call, owning retry logic and token usage extraction. It is created once per Agent instance (lazy initialization via `getLLM()`) and reused across calls.

**Interface:**
- `invoke(input)` — non-streaming. Wraps the full call in `streamWithRetry`, collects all chunks, returns `{ response, tokenUsage }`.
- `stream(input)` — streaming. Returns `{ textStream, usage }` handle without retry. Consumer is responsible for error handling.

**Constructor receives pre-resolved `LanguageModel`** (not a model string). Model resolution (`resolveModel`) remains an independent module. This separation means:
- LLMInvoker is stateless — no global provider registry
- Tests inject mock `LanguageModel` directly without `registerProvider` indirection
- Model resolution is a config concern, LLM invocation is an execution concern

**Why `invoke()` retries but `stream()` does not:** Retry requires consuming the full response to detect errors. Mid-stream retry is infeasible — partial output has already reached the consumer. The `invoke()` path collects everything behind a promise, so retry is transparent. For `stream()`, transient errors propagate to the consumer who can retry the entire pipeline.

**Why `invoke()` uses `fullStream` instead of `textStream`:** The AI SDK v6's `textStream` silently swallows `doStream` errors (e.g., 429/401). The original error surfaces later through `usage` as an `AI_NoOutputGeneratedError` that lacks `statusCode`, breaking retry logic. Using `fullStream` captures `{ type: 'error', error }` events that carry the original error with `statusCode` intact. `maxRetries: 0` is passed to `streamText` to disable the AI SDK's built-in retry, giving `streamWithRetry` full control.

**Why created once per Agent (lazy init):** The `Agent` constructor is synchronous but `resolveModel` is async. A lazy `getLLM()` resolves on first call and caches the result. This preserves the `new Agent(config)` API while ensuring model resolution happens only once. The model string does not change between calls on the same Agent instance.

## Unified Streaming Path

Both `Agent.run()` and `Agent.stream()` go through `PipelineRunner`. The difference is consumption mode:

- `PipelineRunner.run()` — after `invokeLLM` stage, detects `textStream` in context, consumes all chunks into `response`, resolves `usagePromise` into `tokenUsage`.
- `PipelineRunner.stream()` — after `invokeLLM` stage, yields each chunk as a `StreamEvent { type: 'text_delta', text }`, then continues to next stage.

The `invokeLLM` Processor always calls `llm.stream()` and puts `textStream` + `usagePromise` in the pipeline context. It never collects chunks itself — that's PipelineRunner's job.

**Considered options:**
- Separate `run()` and `stream()` code paths (previous approach): `run()` through pipeline, `stream()` calls `streamText` directly. Problem: streaming bypasses all Processors, observability, and tools. Violates ADR-0003 (unified extension point + observability span).
- Pipeline always streams, `run()` consumes (chosen): Single code path through pipeline. PipelineRunner decides consumption mode. "Generate" = stream consumed to completion. Validated by Mastra (single `MastraLLMVNext.stream()` method) and OpenCode (`LLM.Service` only exposes `stream()`).
- Separate `StreamingProcessor` interface: Add `executeStream()` to Processor. Rejected — adds complexity to the Processor interface for a concern that's internal to PipelineRunner.

**Consequences:** `PipelineRunner` now has knowledge of `textStream` consumption — a generic mechanism that works for any stage producing a textStream, not just `invokeLLM`. The `StreamEvent` type defines the full event vocabulary (including `tool_call`, `tool_result` for future agentic loop stages). `PipelineState` replaces `Record<string, unknown>` for `PipelineContext.pipeline`, adding typed fields for `response`, `tokenUsage`, `textStream`, `usagePromise` while preserving the index signature for extensibility.

**Layered pluggability:** The pipeline provides agent-level pluggability (Processors at each stage). LLMInvoker provides LLM-level pluggability (retry, token extraction). These are separate seams. A Processor can replace `invokeLLM` behavior entirely; within the default `invokeLLM`, LLMInvoker can be tested independently.
