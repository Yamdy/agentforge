Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement JSONL session persistence with tree branching and the Pipeline's suspend/resume mechanism for human-in-the-loop workflows.

**JSONL Session Store:**
- Each session is a `.jsonl` file, one entry per line
- Entry shape: `{ id, parentId, role, content, metadata, timestamp }`
- `parentId` enables tree branching — multiple children can share the same parent
- Operations: `create()`, `append(entry)`, `getHistory(sessionId)`, `getBranch(sessionId, entryId)`, `listBranches(sessionId)`
- Entries are human-readable JSON

**Pipeline suspend/resume:**
- A Processor calls `context.suspend(reason)` to pause execution
- Pipeline serializes the current PipelineContext to the session store
- Pipeline returns a `SuspendedResult` containing: sessionId, suspendedStage, reason, resumeToken
- External caller invokes `harness.resume(sessionId, input)` to continue
- Pipeline deserializes Context, injects the new input, resumes from the suspended stage
- The resume creates a new entry in the session with the user's input

**Session restore:** Load a session from JSONL, replay history to reconstruct PipelineContext, continue from where it left off.

## Acceptance criteria

- [ ] Session entries are written as valid JSONL (one JSON object per line)
- [ ] Tree branching works: multiple entries can share the same parentId
- [ ] History can be reconstructed from JSONL entries by following parentId chain
- [ ] Pipeline suspend works: Processor calls context.suspend(), pipeline returns SuspendedResult
- [ ] Pipeline resume works: harness.resume() continues from suspended stage with new input
- [ ] Session restore works: load session, replay history, continue execution
- [ ] Test: suspend pipeline for human input, resume with input, verify execution continues correctly

## Blocked by

- Issue 06 (Full Pipeline Stages)

## User stories covered

7, 52, 53, 54
