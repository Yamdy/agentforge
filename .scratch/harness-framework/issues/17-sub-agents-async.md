Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement async sub-agents that run in the background and notify the main agent (or coordinator) upon completion, enabling parallel long-running work.

**Async sub-agent lifecycle:**
1. Main agent submits work via an `async_task` tool
2. The sub-agent starts in an independent execution context (separate Pipeline run)
3. Main agent receives a task ID immediately and continues operating
4. When the sub-agent completes, an event is emitted: `async_task_completed { taskId, summary, status }`
5. Main agent (or coordinator) can consume the event and incorporate the result

**Task management tools:**
- `async_task` — submit a new async task (name, prompt, config)
- `check_task` — check status of a running task (pending, running, completed, failed)
- `cancel_task` — cancel a running task
- `list_tasks` — list all tasks and their statuses

**Isolation:** Async sub-agents run in their own Pipeline with fully isolated PipelineContext. They do NOT share memory, session, or context with the parent.

**Event integration:** Task completion events flow through the same observability pipeline — the sub-agent's execution creates a separate trace tree linked to the parent via the taskId.

## Acceptance criteria

- [ ] Main agent can submit an async task and receive a task ID immediately
- [ ] Async sub-agent runs independently with isolated context
- [ ] Task completion emits an event with summary and status
- [ ] `check_task` returns current status of a running task
- [ ] `cancel_task` stops a running sub-agent
- [ ] Async sub-agent execution creates separate trace tree linked by taskId
- [ ] Test: submit async task, main agent continues, receives completion event

## Blocked by

- Issue 10 (Sub-agents Sync)
- Issue 09 (Session + Suspend/Resume)

## User stories covered

28
