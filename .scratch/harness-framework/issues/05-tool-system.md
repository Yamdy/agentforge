Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the rich Tool interface, ToolRegistry, and the `executeTools` pipeline stage with its per-tool sub-pipeline.

**Tool interface implementation:** Validate that registered tools have valid Zod inputSchema and outputSchema. Execute method receives validated input and a ToolExecutionContext (containing harness reference, observability context, request context).

**ToolRegistry:** Register tools by name. Lookup by name. Generate tool definitions in the format LLM providers expect (JSON Schema from Zod). Support dynamic registration (tools can be added at runtime by plugins).

**executeTools pipeline stage:** When the LLM response contains tool calls:
1. For each tool call, run the sub-pipeline: `beforeTool → execute → afterTool`
2. Each sub-pipeline step is a Processor extension point AND a span
3. Execute multiple tool calls in parallel by default
4. Support per-tool sequential execution override

**First built-in tool — `echo`:** A trivial tool that returns its input. Used for testing and as a reference implementation.

**Tool output management:** Truncate large tool outputs to prevent context overflow. Configurable max length.

## Acceptance criteria

- [ ] ToolRegistry registers tools and generates LLM-compatible schema definitions from Zod
- [ ] Agent Loop detects tool calls in LLM response, executes tools via executeTools stage, and appends results to messages
- [ ] Multiple tool calls execute in parallel by default
- [ ] Per-tool sub-pipeline (beforeTool → execute → afterTool) runs with spans
- [ ] Tool input is validated against Zod schema; invalid inputs produce clear errors
- [ ] `echo` built-in tool works end-to-end in the Agent Loop
- [ ] Large tool outputs are truncated with a configurable threshold
- [ ] Test: agent receives tool call from LLM, executes echo tool, returns result to LLM for next iteration

## Blocked by

- Issue 02 (Minimal Pipeline + Agent Loop)
- Issue 04 (Observability Core)

## User stories covered

12, 14, 15, 16
