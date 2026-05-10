Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the PermissionProcessor as a `tool.before` Hook with glob-based rules and three permission modes.

**Permission rules:**
```typescript
interface PermissionRule {
  tool: string;           // tool name or glob pattern
  action: 'allow' | 'deny' | 'ask';
  pattern?: string;       // argument path glob
}

type PermissionMode = 'interactive' | 'plan-only' | 'full-auto';
```

**PermissionProcessor as Hook `tool.before`:** Intercepts every tool call before execution:
1. Evaluate tool call against rules (first-match-wins)
2. `ask` action in `interactive` mode: triggers HITL suspend via session
3. `deny` action: returns error to agent
4. `allow` action: pass through

**Audit trail:** Every decision recorded as EventBus event with `permission.decision`, `permission.rule`, `permission.toolName`.

## Acceptance criteria

- [ ] PermissionProcessor registered as Hook `tool.before`
- [ ] Glob pattern rules match tool names and argument paths
- [ ] First-match-wins ruleset evaluation
- [ ] `interactive` mode suspends for user approval and resumes correctly
- [ ] `plan-only` mode denies write/execute tools, allows read tools
- [ ] `full-auto` mode allows all tools
- [ ] Audit events emitted via EventBus
- [ ] Test: tool call denied in plan-only mode with correct reason

## Blocked by

- Issue 07 (Plugin System)
- Plan A (Foundation — HookRunner)

## User stories covered

38, 39, 40, 41
