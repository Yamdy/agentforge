Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the minimal Pipeline Runner and Agent Loop that can process a user input, call an LLM (via a simple mock provider initially), and return a response.

**Pipeline Runner:** Orchestrates Processor execution. Accepts a list of Processors grouped by stage. For each stage, runs registered Processors in order. Each Processor receives a PipelineContext and returns a modified PipelineContext or an AbortSignal. Context is frozen between stages.

**Agent Loop:** The outer loop that drives the pipeline. Takes user input, creates a PipelineContext, runs through pipeline stages. If the LLM response contains tool calls, the loop iterates (since tools are not implemented yet, this slice only handles the no-tool-call path).

**Mock LLM Provider:** A simple interface that returns canned responses for testing. Does NOT use Vercel AI SDK yet — just a callable with `(messages) => response`.

**Minimal stages implemented:**
- `processInput` — validates input, creates initial context
- `invokeLLM` — calls the LLM provider (mock)
- `processOutput` — extracts final text response

## Acceptance criteria

- [ ] Pipeline Runner executes Processors in registration order within each stage
- [ ] Agent Loop processes a user input through 3 minimal stages and returns a response
- [ ] A Processor can abort the pipeline by returning an AbortSignal
- [ ] PipelineContext is frozen between stages (mutations throw)
- [ ] Tests pass: minimal agent processes input, gets mock LLM response, returns output

## Blocked by

- Issue 01 (Monorepo Scaffolding + Core Types)

## User stories covered

1, 2, 6, 8
