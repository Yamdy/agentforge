Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement synchronous sub-agents that execute as tools within the main agent's pipeline, with full context isolation and summary-only return.

**Sub-agent as Tool:** A `task` tool that the main agent can call to delegate work to a sub-agent. The sub-agent is configured with its own AgentConfig (model, tools, system prompt, max iterations).

**Context isolation:** The sub-agent runs its own independent Pipeline with a fresh PipelineContext. The sub-agent's messages, tool calls, and internal reasoning are NOT visible to the parent agent.

**Summary-only return:** When the sub-agent completes, only a summary string is returned to the parent agent (as the tool result). The sub-agent's full execution trace is recorded as nested spans under the parent's `tool_execution` span.

**Sub-agent definition:** Users define sub-agents in AgentConfig as named configurations. The `task` tool accepts a sub-agent name and a prompt string.

**Nested observability:** The sub-agent's pipeline run creates spans nested under the parent's `execute_tool` span, so the full execution tree is observable.

## Acceptance criteria

- [ ] Main agent can delegate to a sub-agent via the `task` tool
- [ ] Sub-agent runs with isolated PipelineContext (no state leakage to parent)
- [ ] Only the summary result is returned to the parent agent
- [ ] Sub-agent execution creates nested spans under the parent's tool_execution span
- [ ] Sub-agent errors are caught and returned as error summaries (not thrown)
- [ ] Test: main agent delegates a task, sub-agent processes it, parent receives summary

## Blocked by

- Issue 05 (Tool System)
- Issue 09 (Session + Suspend/Resume)

## User stories covered

27, 29, 30
