Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the ToolRegistry and integrate AI SDK's built-in multi-step tool execution loop into the Agent.

**Design decision (red-team review):** Do NOT build a custom executeTools loop. AI SDK v6's `streamText` with tools that have `execute` functions automatically handles tool call detection, parallel execution, result feedback to LLM, and multi-step looping (via `maxSteps`). The framework wraps this capability, not replaces it.

**ToolRegistry:** Register tools by name. Generate AI SDK-compatible tool definitions from Zod schemas via `toAiSdkTools()`. The adapter wraps the framework's `Tool.execute(input, context)` (2-arg) into AI SDK's single-arg `execute` signature, injecting `ToolExecutionContext`.

**Agent integration:** `invokeLLM` processor passes `registry.toAiSdkTools()` to `streamText` with `maxSteps` config. AI SDK handles the entire tool execution loop internally.

**before/after hooks:** Implemented as wrappers inside the `toAiSdkTools()` execute adapter, NOT as a separate sub-pipeline. Each tool's `execute` is wrapped to call registered before/after callbacks.

**echo built-in tool:** Trivial tool that returns its input. Reference implementation in `@agentforge/tools`.

**Tool output management:** Truncation applied inside the execute adapter wrapper. Configurable max length.

## Acceptance criteria

- [x] ToolRegistry registers tools and generates AI SDK-compatible tool definitions from Zod
- [x] Agent passes tools to streamText and AI SDK handles multi-step tool execution loop
- [x] Multiple tool calls execute in parallel (AI SDK handles this, we verify end-to-end)
- [x] Tool input is validated against Zod schema; invalid inputs produce clear errors
- [x] `echo` built-in tool works end-to-end in the Agent Loop
- [x] Large tool outputs are truncated with a configurable threshold
- [x] Test: agent receives tool call from LLM, executes echo tool, returns result in next iteration

## Blocked by

- Issue 02 (Minimal Pipeline + Agent Loop)
- Issue 03 (Vercel AI SDK Integration)
- Issue 04 (Observability Core)

## User stories covered

12, 14, 15, 16

## Red-team review notes

- Leverage AI SDK's built-in tool loop, don't rebuild it
- `toAiSdkTools()` adapter is the hardest part — signature mismatch (2-arg vs 1-arg)
- `requireApproval` deferred — no AI SDK equivalent, needs separate mechanism
- before/after hooks are execute wrapper callbacks, not a separate pipeline stage
- Per-tool error handling: catch errors inside execute adapter, return error as tool result
