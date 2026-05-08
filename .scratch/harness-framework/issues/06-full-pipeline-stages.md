Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement all 8 pipeline stages of the Agent Lifecycle Pipeline, filling in the stages that were left minimal in Issue 02. This is the "full engine" that makes the framework production-capable.

**buildContext stage:** Construct system prompt from AgentConfig. Inject AGENTS.md content if found. Load available tool declarations. Prepare the full message array for the LLM call.

**prepareStep stage:** Before each LLM call, prepare the message history. Apply message filtering (remove old system reminders, trim conversation). Determine available tools for this step (allow Processors to filter tools).

**processStepOutput stage:** After each LLM response, validate output quality. This is the **fact injection point** — Processors can inject external verification results here. Support guardrail Processors that can reject outputs and trigger retry.

**evaluateIteration stage:** After tool execution, decide whether to continue the agentic loop. Check max iteration limit. Detect context window overflow. Trigger compression if needed (actual compression logic is a plugin, but the trigger mechanism is here). Support Processors that can redirect the agent's focus.

**Full PipelineContext:** Implement all state layers — request (frozen after creation), iteration (reset each loop), pipeline (mutable, shared across stages), session (loaded from store), config (merged from all layers). Context freezing between stages to prevent mutation outside designated Processors.

**TripWire mechanism:** A Processor can return an AbortSignal with a reason and optional retry flag. If retry is flagged, the pipeline restarts from prepareStep with a modified context.

## Acceptance criteria

- [ ] All 8 pipeline stages execute in the correct order
- [ ] buildContext assembles system prompt + tool declarations into a valid LLM request
- [ ] prepareStep filters message history and tool availability
- [ ] processStepOutput runs guardrail Processors and supports rejection with retry
- [ ] evaluateIteration stops the loop when max iterations reached
- [ ] evaluateIteration detects context overflow and triggers compression (delegates to CompressionProcessor if registered)
- [ ] TripWire abort works: a Processor can stop the pipeline with a reason
- [ ] TripWire retry works: a Processor can request retry from prepareStep
- [ ] PipelineContext has all state layers and is frozen between stages
- [ ] Full end-to-end test: agent processes input, calls LLM, uses tool, loops, and produces final output

## Blocked by

- Issue 03 (Vercel AI SDK Integration)
- Issue 04 (Observability Core)
- Issue 05 (Tool System)

## User stories covered

3, 4, 5, 7, 23
