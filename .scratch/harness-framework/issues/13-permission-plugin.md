Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the PermissionProcessor plugin that enforces safety boundaries at the tool execution level via the beforeTool sub-pipeline stage.

**PermissionProcessor at beforeTool:** Intercepts every tool call before execution:
1. Evaluate tool call against the configured ruleset
2. Ruleset is a list of rules: `{ pattern: glob, effect: 'allow' | 'deny', reason?: string }`
3. Rules are evaluated in order, first match wins
4. If no rule matches, apply the default policy based on permission mode

**Three permission modes:**
- `interactive` — ask the user for approval via suspend/resume. The pipeline suspends, presents the tool call details, and waits for user response.
- `plan-only` — deny all tools that modify state (write, execute, delete). Allow read-only tools (read, glob, grep).
- `full-auto` — allow everything. No checks.

**Glob pattern matching:** Patterns match against `<toolName>:<argPath>` format. Examples: `shell:*` (all shell commands), `write:*.secret` (writes to .secret files), `read:*` (all reads).

**Audit trail:** Every permission decision (allow/deny) is recorded in the beforeTool span attributes: `permission.decision`, `permission.reason`, `permission.matched_rule`.

## Acceptance criteria

- [ ] PermissionProcessor intercepts tool calls at beforeTool stage
- [ ] Glob pattern rules match correctly against toolName:argPath
- [ ] First-match-wins ruleset evaluation works
- [ ] `interactive` mode suspends pipeline for user approval and resumes correctly
- [ ] `plan-only` mode denies write/execute tools and allows read tools
- [ ] `full-auto` mode allows all tools without checking
- [ ] All decisions are recorded in span attributes for audit
- [ ] Test: tool call denied in plan-only mode produces denial with correct reason

## Blocked by

- Issue 07 (Plugin System)
- Issue 09 (Session + Suspend/Resume)

## User stories covered

38, 39, 40, 41
