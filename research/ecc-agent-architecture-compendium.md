# ECC Agent Architecture Compendium

> Mechanical compilation of the ECC skill documents indexed in `ecc-agent-architecture-index.md`.
> The source text for each skill is preserved verbatim; only the wrapper and ordering are added.

## Table of Contents

1. agent-architecture-audit
2. agent-harness-construction
3. agentic-os
4. autonomous-agent-harness
5. agentic-engineering
6. ai-first-engineering
7. continuous-agent-loop
8. autonomous-loops
9. ralphinho-rfc-pipeline
10. plan-orchestrate
11. team-builder
12. dmux-workflows
13. claude-devfleet
14. council
15. agent-eval
16. verification-loop
17. santa-method
18. agent-introspection-debugging
19. skill-comply
20. skill-stocktake
21. continuous-learning-v2
22. ck
23. context-budget
24. strategic-compact
25. token-budget-advisor
26. safety-guard
27. workspace-surface-audit
28. automation-audit-ops
29. agent-sort
30. architecture-decision-records
31. prompt-optimizer

## 1. agent-architecture-audit

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-architecture-audit/SKILL.md

---
name: agent-architecture-audit
description: Full-stack diagnostic for agent and LLM applications. Audits the 12-layer agent stack for wrapper regression, memory pollution, tool discipline failures, hidden repair loops, and rendering corruption. Produces severity-ranked findings with code-first fixes. Essential for developers building agent applications, autonomous loops, or any LLM-powered feature.
origin: oh-my-agent-check
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Agent Architecture Audit

A diagnostic workflow for agent systems that hide failures behind wrapper layers, stale memory, retry loops, or transport/rendering mutations.

## When to Activate

**MANDATORY for:**
- Releasing any agent or LLM-powered application to production
- Shipping features with tool calling, memory, or multi-step workflows
- Agent behavior degrades after adding wrapper layers
- User reports "the agent is getting worse" or "tools are flaky"
- Same model works in playground but breaks inside your wrapper
- Debugging agent behavior for more than 15 minutes without finding root cause

**Especially critical when:**
- You've added new prompt layers, tool definitions, or memory systems
- Different agents in your system behave inconsistently
- The model was fine yesterday but is hallucinating today
- You suspect hidden repair/retry loops silently mutating responses

**Do not use for:**
- General code debugging — use `agent-introspection-debugging`
- Code review — use language-specific reviewer agents
- Security scanning — use `security-review` or `security-review/scan`
- Agent performance benchmarking — use `agent-eval`
- Writing new features — use the appropriate workflow skill

## The 12-Layer Stack

Every agent system has these layers. Any of them can corrupt the answer:

| # | Layer | What Goes Wrong |
|---|-------|----------------|
| 1 | System prompt | Conflicting instructions, instruction bloat |
| 2 | Session history | Stale context injection from previous turns |
| 3 | Long-term memory | Pollution across sessions, old topics in new conversations |
| 4 | Distillation | Compressed artifacts re-entering as pseudo-facts |
| 5 | Active recall | Redundant re-summary layers wasting context |
| 6 | Tool selection | Wrong tool routing, model skips required tools |
| 7 | Tool execution | Hallucinated execution — claims to call but doesn't |
| 8 | Tool interpretation | Misread or ignored tool output |
| 9 | Answer shaping | Format corruption in final response |
| 10 | Platform rendering | Transport-layer mutation (UI, API, CLI mutates valid answers) |
| 11 | Hidden repair loops | Silent fallback/retry agents running second LLM pass |
| 12 | Persistence | Expired state or cached artifacts reused as live evidence |

## Common Failure Patterns

### 1. Wrapper Regression

The base model produces correct answers, but the wrapper layers make it worse.

**Symptoms:**
- Model works fine in playground or direct API call, breaks in your agent
- Added a new prompt layer, existing behavior degraded
- Agent sounds confident but is confidently wrong
- "It was working before the last update"

### 2. Memory Contamination

Old topics leak into new conversations through history, memory retrieval, or distillation.

**Symptoms:**
- Agent brings up unrelated past topics
- User corrections don't stick (old memory overwrites new)
- Same-session artifacts re-enter as pseudo-facts
- Memory grows without bound, degrading response quality over time

### 3. Tool Discipline Failure

Tools are declared in the prompt but not enforced in code. The model skips them or hallucinates execution.

**Symptoms:**
- "Must use tool X" in prompt, but model answers without calling it
- Tool results look correct but were never actually executed
- Different tools fight over the same responsibility
- Model uses tool when it shouldn't, or skips it when it must

### 4. Rendering/Transport Corruption

The agent's internal answer is correct, but the platform layer mutates it during delivery.

**Symptoms:**
- Logs show correct answer, user sees broken output
- Markdown rendering, JSON parsing, or streaming fragments corrupt valid responses
- Hidden fallback agent quietly replaces the answer before delivery
- Output differs between terminal and UI

### 5. Hidden Agent Layers

Silent repair, retry, summarization, or recall agents run without explicit contracts.

**Symptoms:**
- Output changes between internal generation and user delivery
- "Auto-fix" loops run a second LLM pass the user doesn't know about
- Multiple agents modify the same output without coordination
- Answers get "smoothed" or "corrected" by invisible layers

## Audit Workflow

### Phase 1: Scope

Define what you're auditing:

- **Target system** — what agent application?
- **Entrypoints** — how do users interact with it?
- **Model stack** — which LLM(s) and providers?
- **Symptoms** — what does the user report?
- **Time window** — when did it start?
- **Layers to audit** — which of the 12 layers apply?

### Phase 2: Evidence Collection

Gather evidence from the codebase:

- **Source code** — agent loop, tool router, memory admission, prompt assembly
- **Logs** — historical session traces, tool call records
- **Config** — prompt templates, tool schemas, provider settings
- **Memory files** — SOPs, knowledge bases, session archives

Use `rg` to search for anti-patterns:

```bash
# Tool requirements expressed only in prompt text (not code)
rg "must.*tool|必须.*工具|required.*call" --type md

# Tool execution without validation
rg "tool_call|toolCall|tool_use" --type py --type ts

# Hidden LLM calls outside main agent loop
rg "completion|chat\.create|messages\.create|llm\.invoke"

# Memory admission without user-correction priority
rg "memory.*admit|long.*term.*update|persist.*memory" --type py --type ts

# Fallback loops that run additional LLM calls
rg "fallback|retry.*llm|repair.*prompt|re-?prompt" --type py --type ts

# Silent output mutation
rg "mutate|rewrite.*response|transform.*output|shap" --type py --type ts
```

### Phase 3: Failure Mapping

For each finding, document:

- **Symptom** — what the user sees
- **Mechanism** — how the wrapper causes it
- **Source layer** — which of the 12 layers
- **Root cause** — the deepest cause
- **Evidence** — file:line or log:row reference
- **Confidence** — 0.0 to 1.0

### Phase 4: Fix Strategy

Default fix order (code-first, not prompt-first):

1. **Code-gate tool requirements** — enforce in code, not just prompt text
2. **Remove or narrow hidden repair agents** — make fallback explicit with contracts
3. **Reduce context duplication** — same info through prompt + history + memory + distillation
4. **Tighten memory admission** — user corrections > agent assertions
5. **Tighten distillation triggers** — don't compress what shouldn't be compressed
6. **Reduce rendering mutation** — pass-through, don't transform
7. **Convert to typed JSON envelopes** — structured internal flow, not freeform prose

## Severity Model

| Level | Meaning | Action |
|-------|---------|--------|
| `critical` | Agent can confidently produce wrong operational behavior | Fix before next release |
| `high` | Agent frequently degrades correctness or stability | Fix this sprint |
| `medium` | Correctness usually survives but output is fragile or wasteful | Plan for next cycle |
| `low` | Mostly cosmetic or maintainability issues | Backlog |

## Output Format

Present findings to the user in this order:

1. **Severity-ranked findings** (most critical first)
2. **Architecture diagnosis** (which layer corrupted what, and why)
3. **Ordered fix plan** (code-first, not prompt-first)

Do not lead with compliments or summaries. If the system is broken, say so directly.

## Quick Diagnostic Questions

When auditing an agent system, answer these:

| # | Question | If Yes → |
|---|----------|----------|
| 1 | Can the model skip a required tool and still answer? | Tool not code-gated |
| 2 | Does old conversation content appear in new turns? | Memory contamination |
| 3 | Is the same info in system prompt AND memory AND history? | Context duplication |
| 4 | Does the platform run a second LLM pass before delivery? | Hidden repair loop |
| 5 | Does the output differ between internal generation and user delivery? | Rendering corruption |
| 6 | Are "must use tool X" rules only in prompt text? | Tool discipline failure |
| 7 | Can the agent's own monologue become persistent memory? | Memory poisoning |

## Anti-Patterns to Avoid

- Avoid blaming the model before falsifying wrapper-layer regressions.
- Avoid blaming memory without showing the contamination path.
- Do not let a clean current state erase a dirty historical incident.
- Do not treat markdown prose as a trustworthy internal protocol.
- Do not accept "must use tool" in prompt text when code never enforces it.
- Keep findings direct, evidence-backed, and severity-ranked.

## Report Schema

Audits should produce structured reports following this shape:

```json
{
  "schema_version": "ecc.agent-architecture-audit.report.v1",
  "executive_verdict": {
    "overall_health": "high_risk",
    "primary_failure_mode": "string",
    "most_urgent_fix": "string"
  },
  "scope": {
    "target_name": "string",
    "model_stack": ["string"],
    "layers_to_audit": ["string"]
  },
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "title": "string",
      "mechanism": "string",
      "source_layer": "string",
      "root_cause": "string",
      "evidence_refs": ["file:line"],
      "confidence": 0.0,
      "recommended_fix": "string"
    }
  ],
  "ordered_fix_plan": [
    { "order": 1, "goal": "string", "why_now": "string", "expected_effect": "string" }
  ]
}
```

## Related Skills

- `agent-introspection-debugging` — Debug agent runtime failures (loops, timeouts, state errors)
- `agent-eval` — Benchmark agent performance head-to-head
- `security-review` — Security audit for code and configuration
- `autonomous-agent-harness` — Set up autonomous agent operations
- `agent-harness-construction` — Build agent harnesses from scratch

---

## 2. agent-harness-construction

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-harness-construction/SKILL.md

---
name: agent-harness-construction
description: Design and optimize AI agent action spaces, tool definitions, and observation formatting for higher completion rates.
origin: ECC
---

# Agent Harness Construction

Use this skill when you are improving how an agent plans, calls tools, recovers from errors, and converges on completion.

## Core Model

Agent output quality is constrained by:
1. Action space quality
2. Observation quality
3. Recovery quality
4. Context budget quality

## Action Space Design

1. Use stable, explicit tool names.
2. Keep inputs schema-first and narrow.
3. Return deterministic output shapes.
4. Avoid catch-all tools unless isolation is impossible.

## Granularity Rules

- Use micro-tools for high-risk operations (deploy, migration, permissions).
- Use medium tools for common edit/read/search loops.
- Use macro-tools only when round-trip overhead is the dominant cost.

## Observation Design

Every tool response should include:
- `status`: success|warning|error
- `summary`: one-line result
- `next_actions`: actionable follow-ups
- `artifacts`: file paths / IDs

## Error Recovery Contract

For every error path, include:
- root cause hint
- safe retry instruction
- explicit stop condition

## Context Budgeting

1. Keep system prompt minimal and invariant.
2. Move large guidance into skills loaded on demand.
3. Prefer references to files over inlining long documents.
4. Compact at phase boundaries, not arbitrary token thresholds.

## Architecture Pattern Guidance

- ReAct: best for exploratory tasks with uncertain path.
- Function-calling: best for structured deterministic flows.
- Hybrid (recommended): ReAct planning + typed tool execution.

## Benchmarking

Track:
- completion rate
- retries per task
- pass@1 and pass@3
- cost per successful task

## Anti-Patterns

- Too many tools with overlapping semantics.
- Opaque tool output with no recovery hints.
- Error-only output without next steps.
- Context overloading with irrelevant references.

---

## 3. agentic-os

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agentic-os/SKILL.md

---
name: agentic-os
description: Build persistent multi-agent operating systems on Claude Code. Covers kernel architecture, specialist agents, slash commands, file-based memory, scheduled automation, and state management without external databases.
origin: ECC
---

# Agentic OS

Treat Claude Code as a persistent runtime / operating system rather than a chat session. This skill codifies the architecture used by production agentic setups: a kernel config that routes tasks to specialist agents, persistent file-based memory, scheduled automation, and a JSON/markdown data layer.

## When to Activate

- Building a multi-agent workflow inside Claude Code
- Setting up persistent Claude Code automation that survives session restarts
- Creating a "personal OS" or "agentic OS" for recurring tasks
- User says "agentic OS", "personal OS", "multi-agent", "agent coordinator", "persistent agent"
- Structuring long-running projects where context must survive across sessions

## Architecture Overview

The Agentic OS has four layers. Each layer is a directory in your project root.

```
project-root/
├── CLAUDE.md          # Kernel: identity, routing rules, agent registry
├── agents/            # Specialist agent definitions (markdown prompts)
├── .claude/commands/  # Slash commands: user-facing CLI
├── scripts/           # Daemon scripts: scheduled or event-driven tasks
└── data/              # State: JSON/markdown filesystem, no external DB
```

### Layer Responsibilities

| Layer | Purpose | Persistence |
|---|---|---|
| Kernel (`CLAUDE.md`) | Identity, routing, model policies, agent registry | Git-tracked |
| Agents (`agents/`) | Specialist identities with scoped tools and memory | Git-tracked |
| Commands (`.claude/commands/`) | User-facing slash commands (`/daily-sync`, `/outreach`) | Git-tracked |
| Scripts (`scripts/`) | Python/JS daemons triggered by cron or webhooks | Git-tracked |
| State (`data/`) | Append-only logs, project state, decision records | Git-ignored or tracked |

## The Kernel

`CLAUDE.md` is the kernel. It acts as the COO / orchestrator. Claude reads it at session start and uses it to route work.

### Kernel Structure

```markdown
# CLAUDE.md - Agentic OS Kernel

## Identity
You are the COO of [project-name]. You route tasks to specialist agents.
You never write code directly. You delegate to the right agent and synthesize results.

## Agent Registry

| Agent | Role | Trigger |
|---|---|---|
| @dev | Code, architecture, debugging | User says "build", "fix", "refactor" |
| @writer | Documentation, content, emails | User says "write", "draft", "blog" |
| @researcher | Research, analysis, fact-checking | User says "research", "analyze", "compare" |
| @ops | DevOps, deployment, infrastructure | User says "deploy", "CI", "server" |

## Routing Rules
1. Parse the user request for intent keywords
2. Match to the Agent Registry trigger column
3. Load the corresponding agent file from `agents/<name>.md`
4. Hand off execution with full context
5. Synthesize and present the result back to the user

## Model Policies
- Default model: use the repository or harness default.
- @dev tasks: prefer a higher-reasoning model for complex architecture.
- @researcher tasks: use the configured research-capable model and approved search tools.
- Cost ceiling: warn before exceeding the project's configured spend threshold.
```

### Key Principle

The kernel should be **small and declarative**. Routing logic lives in plain markdown tables, not code. This makes the system inspectable and editable without debugging.

## Specialist Agents

Each agent is a standalone markdown file in `agents/`. Claude loads the relevant agent file when routing a task.

### Agent Definition Format

```markdown
# @dev - Software Engineer

## Identity
You are a senior software engineer. You write clean, tested, production-grade code.
You prefer simple solutions. You ask clarifying questions when requirements are ambiguous.

## Memory Scope
- Read `data/projects/<current-project>.md` for context
- Read `data/decisions/` for architectural decisions
- Append execution logs to `data/logs/<date>-@dev.md`

## Tool Access
- Full filesystem access within project root
- Git operations (status, diff, commit, branch)
- Test runner access
- MCP servers as configured in `.claude/mcp.json`

## Constraints
- Always write tests for new features
- Never commit directly to `main`; use feature branches
- Prefer editing existing files over creating new ones
- Keep functions under 50 lines when possible
```

### Multi-Agent Collaboration Pattern

When a task spans multiple agents, the kernel runs them sequentially or in parallel:

```
User: "Build a landing page and write the launch blog post"

Kernel routing:
1. @dev - "Build a landing page with [requirements]"
2. @writer - "Write a launch blog post for [product] using the landing page copy"
3. Kernel synthesizes both outputs into a unified response
```

For parallel execution, use Claude Code's background task capability or shell scripts that invoke Claude Code with specific agent contexts.

## Commands and Daily Workflows

Slash commands are markdown files in `.claude/commands/`. They define reusable workflows.

### Command Structure

```markdown
# /daily-sync

Run the morning briefing:

1. Read `data/logs/last-sync.md` for context
2. Check project status: `git status`, pending PRs, CI health
3. Review `data/inbox/` for new tasks or decisions needed
4. Generate a summary of blockers, priorities, and next actions
5. Append the briefing to `data/logs/daily/<date>.md`
```

### Standard Command Set

| Command | Purpose |
|---|---|
| `/daily-sync` | Morning briefing: status, blockers, priorities |
| `/outreach` | Run outreach workflow (email, LinkedIn, etc.) |
| `/research <topic>` | Deep research with citation tracking |
| `/apply-jobs` | Tailor resume + cover letter for a target role |
| `/analytics` | Pull metrics from Stripe, GitHub, or custom sources |
| `/interview-prep` | Generate flashcards or mock interview questions |
| `/decision <topic>` | Log a decision with pros/cons and chosen path |

### Activating Commands

Place command files in `.claude/commands/<command-name>.md`. Claude Code auto-discovers them. Users invoke them with `/<command-name>`.

## Persistent Memory

Memory is file-based. No vector DB, no Redis, no PostgreSQL. JSON and markdown files in `data/` are the database.

### Memory Directory Structure

```
data/
├── daily-logs/         # Append-only daily activity logs
├── projects/           # Per-project context files
├── decisions/          # Architectural and business decisions (ADR format)
├── inbox/              # New tasks or ideas awaiting triage
├── contacts/           # People, companies, relationship notes
└── templates/          # Reusable prompts and formats
```

### Daily Log Format

```markdown
# 2026-04-22 - Daily Log

## Sessions
- 09:00 - Session 1: Refactored auth module (@dev)
- 11:30 - Session 2: Drafted investor update (@writer)

## Decisions
- Switched from JWT to session cookies (see `data/decisions/2026-04-22-auth.md`)

## Blockers
- Waiting on API key from vendor (follow up 2026-04-24)

## Next Actions
- [ ] Merge auth refactor PR
- [ ] Send investor update for review
```

### Auto-Reflection Pattern

At the end of each session, the kernel appends a reflection:

```markdown
## Reflection - Session 3
- What worked: Parallel agent execution saved 20 minutes
- What didn't: @researcher hit a paywalled source, need better source ranking
- What to change: Add `source-tier` field to research notes (A/B/C credibility)
```

This creates a feedback loop that improves the system over time without code changes.

## Scheduled Automation

Agentic OS tasks run on a schedule using external cron, not Claude Code's built-in cron (which dies when the session ends).

### macOS: LaunchAgent

```xml
<!-- ~/Library/LaunchAgents/com.agentic.daily-sync.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ...>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agentic.daily-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/claude</string>
        <string>--cwd</string>
        <string>/path/to/project</string>
        <string>--command</string>
        <string>/daily-sync</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>8</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/agentic-daily-sync.log</string>
</dict>
</plist>
```

### Linux: systemd Timer

```ini
# ~/.config/systemd/user/agentic-daily-sync.service
[Unit]
Description=Agentic OS Daily Sync

[Service]
Type=oneshot
ExecStart=/usr/local/bin/claude --cwd /path/to/project --command /daily-sync
```

```ini
# ~/.config/systemd/user/agentic-daily-sync.timer
[Unit]
Description=Run daily sync every morning

[Timer]
OnCalendar=*-*-* 8:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

### Cross-Platform: pm2

```bash
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'agentic-daily-sync',
    script: 'claude',
    args: '--cwd /path/to/project --command /daily-sync',
    cron_restart: '0 8 * * *',
    autorestart: false
  }]
};
```

## Data Layer

The data layer is your filesystem. Use JSON for structured data and markdown for narrative content.

### JSON for Structured State

```json
// data/projects/website-v2.json
{
  "name": "Website v2",
  "status": "in-progress",
  "milestone": "beta-launch",
  "agents_involved": ["@dev", "@writer"],
  "files": {
    "spec": "docs/website-v2-spec.md",
    "design": "designs/website-v2.fig"
  },
  "metrics": {
    "commits": 47,
    "last_session": "2026-04-22T11:30:00Z"
  }
}
```

### Markdown for Narrative

Use markdown for anything a human reads: decisions, logs, research notes, contact records.

### Schema Evolution

Never rename existing fields. Add new fields and mark old ones deprecated:

```json
{
  "name": "Website v2",
  "status": "in-progress",
  "milestone": "beta-launch",
  "_deprecated_priority": "high",
  "priority_v2": { "level": "high", "rationale": "Blocks investor demo" }
}
```

This keeps historical data readable without migration scripts.

## Anti-Patterns

### Monolithic Single Agent

```markdown
# BAD - One agent does everything
You are a full-stack developer, writer, researcher, and DevOps engineer.
```

Split into specialist agents. The kernel handles routing.

### Stateless Sessions

```markdown
# BAD - No memory between sessions
Starting fresh every time Claude Code opens.
```

Always read `data/` at session start and write back at session end.

### Hardcoded Credentials

```markdown
# BAD - API keys in agent files or CLAUDE.md
Your OpenAI API key is sk-xxxxxxxx
```

Use environment variables or a `.env` file loaded by scripts. Agents reference `process.env.API_KEY`.

### External Database for Simple State

```markdown
# BAD - PostgreSQL for a solo user's agentic OS
```

Use JSON/markdown files until you have multiple concurrent users or GBs of data.

### Over-Engineered Routing

```markdown
# BAD - Routing logic in code instead of markdown tables
if (intent.includes('deploy')) { agent = opsAgent; }
```

Keep routing declarative in `CLAUDE.md` markdown tables. It is inspectable, editable, and debuggable.

## Best Practices

- [ ] `CLAUDE.md` is under 200 lines and fits in context window
- [ ] Each agent file is under 100 lines and focused on one domain
- [ ] `data/` is git-ignored for sensitive logs, git-tracked for decisions and specs
- [ ] Commands use imperative names: `/daily-sync`, not `/run-daily-sync`
- [ ] Logs are append-only; never edit past daily logs
- [ ] Every agent has a `Memory Scope` section defining what files it reads
- [ ] Reflections are written at the end of every session
- [ ] Scheduled tasks use external cron (LaunchAgent, systemd, pm2), not Claude Code's session cron
- [ ] Cost tracking: log API spend per session in `data/logs/<date>-costs.json`
- [ ] One project = one Agentic OS. Do not share a single `CLAUDE.md` across unrelated projects.

---

## 4. autonomous-agent-harness

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/autonomous-agent-harness/SKILL.md

---
name: autonomous-agent-harness
description: Transform Claude Code into a fully autonomous agent system with persistent memory, scheduled operations, computer use, and task queuing. Replaces standalone agent frameworks (Hermes, AutoGPT) by leveraging Claude Code's native crons, dispatch, MCP tools, and memory. Use when the user wants continuous autonomous operation, scheduled tasks, or a self-directing agent loop.
origin: ECC
---

# Autonomous Agent Harness

Turn Claude Code into a persistent, self-directing agent system using only native features and MCP servers.

## Consent and Safety Boundaries

Autonomous operation must be explicitly requested and scoped by the user. Do not create schedules, dispatch remote agents, write persistent memory, use computer control, post externally, modify third-party resources, or act on private communications unless the user has approved that capability and the target workspace for the current setup.

Prefer dry-run plans and local queue files before enabling recurring or event-driven actions. Keep credentials, private workspace exports, personal datasets, and account-specific automations out of reusable ECC artifacts.

## When to Activate

- User wants an agent that runs continuously or on a schedule
- Setting up automated workflows that trigger periodically
- Building a personal AI assistant that remembers context across sessions
- User says "run this every day", "check on this regularly", "keep monitoring"
- Wants to replicate functionality from Hermes, AutoGPT, or similar autonomous agent frameworks
- Needs computer use combined with scheduled execution

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Claude Code Runtime                        │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │  Crons   │  │ Dispatch │  │ Memory   │  │ Computer    │ │
│  │ Schedule │  │ Remote   │  │ Store    │  │ Use         │ │
│  │ Tasks    │  │ Agents   │  │          │  │             │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬──────┘ │
│       │              │             │                │        │
│       ▼              ▼             ▼                ▼        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              ECC Skill + Agent Layer                  │    │
│  │                                                      │    │
│  │  skills/     agents/     commands/     hooks/        │    │
│  └──────────────────────────────────────────────────────┘    │
│       │              │             │                │        │
│       ▼              ▼             ▼                ▼        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              MCP Server Layer                        │    │
│  │                                                      │    │
│  │  memory    github    exa    supabase    browser-use  │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Persistent Memory

Use Claude Code's built-in memory system enhanced with MCP memory server for structured data.

**Built-in memory** (`~/.claude/projects/*/memory/`):
- User preferences, feedback, project context
- Stored as markdown files with frontmatter
- Automatically loaded at session start

**MCP memory server** (structured knowledge graph):
- Entities, relations, observations
- Queryable graph structure
- Cross-session persistence

**Memory patterns:**

```
# Short-term: current session context
Use TodoWrite for in-session task tracking

# Medium-term: project memory files
Write to ~/.claude/projects/*/memory/ for cross-session recall

# Long-term: MCP knowledge graph
Use mcp__memory__create_entities for permanent structured data
Use mcp__memory__create_relations for relationship mapping
Use mcp__memory__add_observations for new facts about known entities
```

### 2. Scheduled Operations (Crons)

Use Claude Code's scheduled tasks to create recurring agent operations.

**Setting up a cron:**

```
# Via MCP tool
mcp__scheduled-tasks__create_scheduled_task({
  name: "daily-pr-review",
  schedule: "0 9 * * 1-5",  # 9 AM weekdays
  prompt: "Review all open PRs in affaan-m/everything-claude-code. For each: check CI status, review changes, flag issues. Post summary to memory.",
  project_dir: "/path/to/repo"
})

# Via claude -p (programmatic mode)
echo "Review open PRs and summarize" | claude -p --project /path/to/repo
```

**Useful cron patterns:**

| Pattern | Schedule | Use Case |
|---------|----------|----------|
| Daily standup | `0 9 * * 1-5` | Review PRs, issues, deploy status |
| Weekly review | `0 10 * * 1` | Code quality metrics, test coverage |
| Hourly monitor | `0 * * * *` | Production health, error rate checks |
| Nightly build | `0 2 * * *` | Run full test suite, security scan |
| Pre-meeting | `*/30 * * * *` | Prepare context for upcoming meetings |

### 3. Dispatch / Remote Agents

Trigger Claude Code agents remotely for event-driven workflows.

**Dispatch patterns:**

```bash
# Trigger from CI/CD
curl -X POST "https://api.anthropic.com/dispatch" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{"prompt": "Build failed on main. Diagnose and fix.", "project": "/repo"}'

# Trigger from webhook
# GitHub webhook → dispatch → Claude agent → fix → PR

# Trigger from another agent
claude -p "Analyze the output of the security scan and create issues for findings"
```

### 4. Computer Use

Leverage Claude's computer-use MCP for physical world interaction.

**Capabilities:**
- Browser automation (navigate, click, fill forms, screenshot)
- Desktop control (open apps, type, mouse control)
- File system operations beyond CLI

**Use cases within the harness:**
- Automated testing of web UIs
- Form filling and data entry
- Screenshot-based monitoring
- Multi-app workflows

### 5. Task Queue

Manage a persistent queue of tasks that survive session boundaries.

**Implementation:**

```
# Task persistence via memory
Write task queue to ~/.claude/projects/*/memory/task-queue.md

# Task format
---
name: task-queue
type: project
description: Persistent task queue for autonomous operation
---

## Active Tasks
- [ ] PR #123: Review and approve if CI green
- [ ] Monitor deploy: check /health every 30 min for 2 hours
- [ ] Research: Find 5 leads in AI tooling space

## Completed
- [x] Daily standup: reviewed 3 PRs, 2 issues
```

## Replacing Hermes

| Hermes Component | ECC Equivalent | How |
|------------------|---------------|-----|
| Gateway/Router | Claude Code dispatch + crons | Scheduled tasks trigger agent sessions |
| Memory System | Claude memory + MCP memory server | Built-in persistence + knowledge graph |
| Tool Registry | MCP servers | Dynamically loaded tool providers |
| Orchestration | ECC skills + agents | Skill definitions direct agent behavior |
| Computer Use | computer-use MCP | Native browser and desktop control |
| Context Manager | Session management + memory | ECC 2.0 session lifecycle |
| Task Queue | Memory-persisted task list | TodoWrite + memory files |

## Setup Guide

### Step 1: Configure MCP Servers

Ensure these are in `~/.claude.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@anthropic/memory-mcp-server"]
    },
    "scheduled-tasks": {
      "command": "npx",
      "args": ["-y", "@anthropic/scheduled-tasks-mcp-server"]
    },
    "computer-use": {
      "command": "npx",
      "args": ["-y", "@anthropic/computer-use-mcp-server"]
    }
  }
}
```

### Step 2: Create Base Crons

```bash
# Daily morning briefing
claude -p "Create a scheduled task: every weekday at 9am, review my GitHub notifications, open PRs, and calendar. Write a morning briefing to memory."

# Continuous learning
claude -p "Create a scheduled task: every Sunday at 8pm, extract patterns from this week's sessions and update the learned skills."
```

### Step 3: Initialize Memory Graph

```bash
# Bootstrap your identity and context
claude -p "Create memory entities for: me (user profile), my projects, my key contacts. Add observations about current priorities."
```

### Step 4: Enable Computer Use (Optional)

Grant computer-use MCP the necessary permissions for browser and desktop control.

## Example Workflows

### Autonomous PR Reviewer
```
Cron: every 30 min during work hours
1. Check for new PRs on watched repos
2. For each new PR:
   - Pull branch locally
   - Run tests
   - Review changes with code-reviewer agent
   - Post review comments via GitHub MCP
3. Update memory with review status
```

### Personal Research Agent
```
Cron: daily at 6 AM
1. Check saved search queries in memory
2. Run Exa searches for each query
3. Summarize new findings
4. Compare against yesterday's results
5. Write digest to memory
6. Flag high-priority items for morning review
```

### Meeting Prep Agent
```
Trigger: 30 min before each calendar event
1. Read calendar event details
2. Search memory for context on attendees
3. Pull recent email/Slack threads with attendees
4. Prepare talking points and agenda suggestions
5. Write prep doc to memory
```

## Constraints

- Cron tasks run in isolated sessions — they don't share context with interactive sessions unless through memory.
- Computer use requires explicit permission grants. Don't assume access.
- Remote dispatch may have rate limits. Design crons with appropriate intervals.
- Memory files should be kept concise. Archive old data rather than letting files grow unbounded.
- Always verify that scheduled tasks completed successfully. Add error handling to cron prompts.

---

## 5. agentic-engineering

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agentic-engineering/SKILL.md

---
name: agentic-engineering
description: Operate as an agentic engineer using eval-first execution, decomposition, and cost-aware model routing.
origin: ECC
---

# Agentic Engineering

Use this skill for engineering workflows where AI agents perform most implementation work and humans enforce quality and risk controls.

## Operating Principles

1. Define completion criteria before execution.
2. Decompose work into agent-sized units.
3. Route model tiers by task complexity.
4. Measure with evals and regression checks.

## Eval-First Loop

1. Define capability eval and regression eval.
2. Run baseline and capture failure signatures.
3. Execute implementation.
4. Re-run evals and compare deltas.

## Task Decomposition

Apply the 15-minute unit rule:
- each unit should be independently verifiable
- each unit should have a single dominant risk
- each unit should expose a clear done condition

## Model Routing

- Haiku: classification, boilerplate transforms, narrow edits
- Sonnet: implementation and refactors
- Opus: architecture, root-cause analysis, multi-file invariants

## Session Strategy

- Continue session for closely-coupled units.
- Start fresh session after major phase transitions.
- Compact after milestone completion, not during active debugging.

## Review Focus for AI-Generated Code

Prioritize:
- invariants and edge cases
- error boundaries
- security and auth assumptions
- hidden coupling and rollout risk

Do not waste review cycles on style-only disagreements when automated format/lint already enforce style.

## Cost Discipline

Track per task:
- model
- token estimate
- retries
- wall-clock time
- success/failure

Escalate model tier only when lower tier fails with a clear reasoning gap.

---

## 6. ai-first-engineering

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/ai-first-engineering/SKILL.md

---
name: ai-first-engineering
description: Engineering operating model for teams where AI agents generate a large share of implementation output.
origin: ECC
---

# AI-First Engineering

Use this skill when designing process, reviews, and architecture for teams shipping with AI-assisted code generation.

## Process Shifts

1. Planning quality matters more than typing speed.
2. Eval coverage matters more than anecdotal confidence.
3. Review focus shifts from syntax to system behavior.

## Architecture Requirements

Prefer architectures that are agent-friendly:
- explicit boundaries
- stable contracts
- typed interfaces
- deterministic tests

Avoid implicit behavior spread across hidden conventions.

## Code Review in AI-First Teams

Review for:
- behavior regressions
- security assumptions
- data integrity
- failure handling
- rollout safety

Minimize time spent on style issues already covered by automation.

## Hiring and Evaluation Signals

Strong AI-first engineers:
- decompose ambiguous work cleanly
- define measurable acceptance criteria
- produce high-signal prompts and evals
- enforce risk controls under delivery pressure

## Testing Standard

Raise testing bar for generated code:
- required regression coverage for touched domains
- explicit edge-case assertions
- integration checks for interface boundaries

---

## 7. continuous-agent-loop

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/continuous-agent-loop/SKILL.md

---
name: continuous-agent-loop
description: Patterns for continuous autonomous agent loops with quality gates, evals, and recovery controls.
origin: ECC
---

# Continuous Agent Loop

This is the v1.8+ canonical loop skill name. It supersedes `autonomous-loops` while keeping compatibility for one release.

## Loop Selection Flow

```text
Start
  |
  +-- Need strict CI/PR control? -- yes --> continuous-pr
  |
  +-- Need RFC decomposition? -- yes --> rfc-dag
  |
  +-- Need exploratory parallel generation? -- yes --> infinite
  |
  +-- default --> sequential
```

## Combined Pattern

Recommended production stack:
1. RFC decomposition (`ralphinho-rfc-pipeline`)
2. quality gates (`plankton-code-quality` + `/quality-gate`)
3. eval loop (`eval-harness`)
4. session persistence (`nanoclaw-repl`)

## Failure Modes

- loop churn without measurable progress
- repeated retries with same root cause
- merge queue stalls
- cost drift from unbounded escalation

## Recovery

- freeze loop
- run `/harness-audit`
- reduce scope to failing unit
- replay with explicit acceptance criteria

---

## 8. autonomous-loops

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/autonomous-loops/SKILL.md

---
name: autonomous-loops
description: "Patterns and architectures for autonomous Claude Code loops — from simple sequential pipelines to RFC-driven multi-agent DAG systems."
origin: ECC
---

# Autonomous Loops Skill

> Compatibility note (v1.8.0): `autonomous-loops` is retained for one release.
> The canonical skill name is now `continuous-agent-loop`. New loop guidance
> should be authored there, while this skill remains available to avoid
> breaking existing workflows.

Patterns, architectures, and reference implementations for running Claude Code autonomously in loops. Covers everything from simple `claude -p` pipelines to full RFC-driven multi-agent DAG orchestration.

## When to Use

- Setting up autonomous development workflows that run without human intervention
- Choosing the right loop architecture for your problem (simple vs complex)
- Building CI/CD-style continuous development pipelines
- Running parallel agents with merge coordination
- Implementing context persistence across loop iterations
- Adding quality gates and cleanup passes to autonomous workflows

## Loop Pattern Spectrum

From simplest to most sophisticated:

| Pattern | Complexity | Best For |
|---------|-----------|----------|
| [Sequential Pipeline](#1-sequential-pipeline-claude--p) | Low | Daily dev steps, scripted workflows |
| [NanoClaw REPL](#2-nanoclaw-repl) | Low | Interactive persistent sessions |
| [Infinite Agentic Loop](#3-infinite-agentic-loop) | Medium | Parallel content generation, spec-driven work |
| [Continuous Claude PR Loop](#4-continuous-claude-pr-loop) | Medium | Multi-day iterative projects with CI gates |
| [De-Sloppify Pattern](#5-the-de-sloppify-pattern) | Add-on | Quality cleanup after any Implementer step |
| [Ralphinho / RFC-Driven DAG](#6-ralphinho--rfc-driven-dag-orchestration) | High | Large features, multi-unit parallel work with merge queue |

---

## 1. Sequential Pipeline (`claude -p`)

**The simplest loop.** Break daily development into a sequence of non-interactive `claude -p` calls. Each call is a focused step with a clear prompt.

### Core Insight

> If you can't figure out a loop like this, it means you can't even drive the LLM to fix your code in interactive mode.

The `claude -p` flag runs Claude Code non-interactively with a prompt, exits when done. Chain calls to build a pipeline:

```bash
#!/bin/bash
# daily-dev.sh — Sequential pipeline for a feature branch

set -e

# Step 1: Implement the feature
claude -p "Read the spec in docs/auth-spec.md. Implement OAuth2 login in src/auth/. Write tests first (TDD). Do NOT create any new documentation files."

# Step 2: De-sloppify (cleanup pass)
claude -p "Review all files changed by the previous commit. Remove any unnecessary type tests, overly defensive checks, or testing of language features (e.g., testing that TypeScript generics work). Keep real business logic tests. Run the test suite after cleanup."

# Step 3: Verify
claude -p "Run the full build, lint, type check, and test suite. Fix any failures. Do not add new features."

# Step 4: Commit
claude -p "Create a conventional commit for all staged changes. Use 'feat: add OAuth2 login flow' as the message."
```

### Key Design Principles

1. **Each step is isolated** — A fresh context window per `claude -p` call means no context bleed between steps.
2. **Order matters** — Steps execute sequentially. Each builds on the filesystem state left by the previous.
3. **Negative instructions are dangerous** — Don't say "don't test type systems." Instead, add a separate cleanup step (see [De-Sloppify Pattern](#5-the-de-sloppify-pattern)).
4. **Exit codes propagate** — `set -e` stops the pipeline on failure.

### Variations

**With model routing:**
```bash
# Research with Opus (deep reasoning)
claude -p --model opus "Analyze the codebase architecture and write a plan for adding caching..."

# Implement with Sonnet (fast, capable)
claude -p "Implement the caching layer according to the plan in docs/caching-plan.md..."

# Review with Opus (thorough)
claude -p --model opus "Review all changes for security issues, race conditions, and edge cases..."
```

**With environment context:**
```bash
# Pass context via files, not prompt length
echo "Focus areas: auth module, API rate limiting" > .claude-context.md
claude -p "Read .claude-context.md for priorities. Work through them in order."
rm .claude-context.md
```

**With `--allowedTools` restrictions:**
```bash
# Read-only analysis pass
claude -p --allowedTools "Read,Grep,Glob" "Audit this codebase for security vulnerabilities..."

# Write-only implementation pass
claude -p --allowedTools "Read,Write,Edit,Bash" "Implement the fixes from security-audit.md..."
```

---

## 2. NanoClaw REPL

**ECC's built-in persistent loop.** A session-aware REPL that calls `claude -p` synchronously with full conversation history.

```bash
# Start the default session
node scripts/claw.js

# Named session with skill context
CLAW_SESSION=my-project CLAW_SKILLS=tdd-workflow,security-review node scripts/claw.js
```

### How It Works

1. Loads conversation history from `~/.claude/claw/{session}.md`
2. Each user message is sent to `claude -p` with full history as context
3. Responses are appended to the session file (Markdown-as-database)
4. Sessions persist across restarts

### When NanoClaw vs Sequential Pipeline

| Use Case | NanoClaw | Sequential Pipeline |
|----------|----------|-------------------|
| Interactive exploration | Yes | No |
| Scripted automation | No | Yes |
| Session persistence | Built-in | Manual |
| Context accumulation | Grows per turn | Fresh each step |
| CI/CD integration | Poor | Excellent |

See the `/claw` command documentation for full details.

---

## 3. Infinite Agentic Loop

**A two-prompt system** that orchestrates parallel sub-agents for specification-driven generation. Developed by disler (credit: @disler).

### Architecture: Two-Prompt System

```
PROMPT 1 (Orchestrator)              PROMPT 2 (Sub-Agents)
┌─────────────────────┐             ┌──────────────────────┐
│ Parse spec file      │             │ Receive full context  │
│ Scan output dir      │  deploys   │ Read assigned number  │
│ Plan iteration       │────────────│ Follow spec exactly   │
│ Assign creative dirs │  N agents  │ Generate unique output │
│ Manage waves         │             │ Save to output dir    │
└─────────────────────┘             └──────────────────────┘
```

### The Pattern

1. **Spec Analysis** — Orchestrator reads a specification file (Markdown) defining what to generate
2. **Directory Recon** — Scans existing output to find the highest iteration number
3. **Parallel Deployment** — Launches N sub-agents, each with:
   - The full spec
   - A unique creative direction
   - A specific iteration number (no conflicts)
   - A snapshot of existing iterations (for uniqueness)
4. **Wave Management** — For infinite mode, deploys waves of 3-5 agents until context is exhausted

### Implementation via Claude Code Commands

Create `.claude/commands/infinite.md`:

```markdown
Parse the following arguments from $ARGUMENTS:
1. spec_file — path to the specification markdown
2. output_dir — where iterations are saved
3. count — integer 1-N or "infinite"

PHASE 1: Read and deeply understand the specification.
PHASE 2: List output_dir, find highest iteration number. Start at N+1.
PHASE 3: Plan creative directions — each agent gets a DIFFERENT theme/approach.
PHASE 4: Deploy sub-agents in parallel (Task tool). Each receives:
  - Full spec text
  - Current directory snapshot
  - Their assigned iteration number
  - Their unique creative direction
PHASE 5 (infinite mode): Loop in waves of 3-5 until context is low.
```

**Invoke:**
```bash
/project:infinite specs/component-spec.md src/ 5
/project:infinite specs/component-spec.md src/ infinite
```

### Batching Strategy

| Count | Strategy |
|-------|----------|
| 1-5 | All agents simultaneously |
| 6-20 | Batches of 5 |
| infinite | Waves of 3-5, progressive sophistication |

### Key Insight: Uniqueness via Assignment

Don't rely on agents to self-differentiate. The orchestrator **assigns** each agent a specific creative direction and iteration number. This prevents duplicate concepts across parallel agents.

---

## 4. Continuous Claude PR Loop

**A production-grade shell script** that runs Claude Code in a continuous loop, creating PRs, waiting for CI, and merging automatically. Created by AnandChowdhary (credit: @AnandChowdhary).

### Core Loop

```
┌─────────────────────────────────────────────────────┐
│  CONTINUOUS CLAUDE ITERATION                        │
│                                                     │
│  1. Create branch (continuous-claude/iteration-N)   │
│  2. Run claude -p with enhanced prompt              │
│  3. (Optional) Reviewer pass — separate claude -p   │
│  4. Commit changes (claude generates message)       │
│  5. Push + create PR (gh pr create)                 │
│  6. Wait for CI checks (poll gh pr checks)          │
│  7. CI failure? → Auto-fix pass (claude -p)         │
│  8. Merge PR (squash/merge/rebase)                  │
│  9. Return to main → repeat                         │
│                                                     │
│  Limit by: --max-runs N | --max-cost $X             │
│            --max-duration 2h | completion signal     │
└─────────────────────────────────────────────────────┘
```

### Installation

> **Warning:** Install continuous-claude from its repository after reviewing the code. Do not pipe external scripts directly to bash.

### Usage

```bash
# Basic: 10 iterations
continuous-claude --prompt "Add unit tests for all untested functions" --max-runs 10

# Cost-limited
continuous-claude --prompt "Fix all linter errors" --max-cost 5.00

# Time-boxed
continuous-claude --prompt "Improve test coverage" --max-duration 8h

# With code review pass
continuous-claude \
  --prompt "Add authentication feature" \
  --max-runs 10 \
  --review-prompt "Run npm test && npm run lint, fix any failures"

# Parallel via worktrees
continuous-claude --prompt "Add tests" --max-runs 5 --worktree tests-worker &
continuous-claude --prompt "Refactor code" --max-runs 5 --worktree refactor-worker &
wait
```

### Cross-Iteration Context: SHARED_TASK_NOTES.md

The critical innovation: a `SHARED_TASK_NOTES.md` file persists across iterations:

```markdown
## Progress
- [x] Added tests for auth module (iteration 1)
- [x] Fixed edge case in token refresh (iteration 2)
- [ ] Still need: rate limiting tests, error boundary tests

## Next Steps
- Focus on rate limiting module next
- The mock setup in tests/helpers.ts can be reused
```

Claude reads this file at iteration start and updates it at iteration end. This bridges the context gap between independent `claude -p` invocations.

### CI Failure Recovery

When PR checks fail, Continuous Claude automatically:
1. Fetches the failed run ID via `gh run list`
2. Spawns a new `claude -p` with CI fix context
3. Claude inspects logs via `gh run view`, fixes code, commits, pushes
4. Re-waits for checks (up to `--ci-retry-max` attempts)

### Completion Signal

Claude can signal "I'm done" by outputting a magic phrase:

```bash
continuous-claude \
  --prompt "Fix all bugs in the issue tracker" \
  --completion-signal "CONTINUOUS_CLAUDE_PROJECT_COMPLETE" \
  --completion-threshold 3  # Stops after 3 consecutive signals
```

Three consecutive iterations signaling completion stops the loop, preventing wasted runs on finished work.

### Key Configuration

| Flag | Purpose |
|------|---------|
| `--max-runs N` | Stop after N successful iterations |
| `--max-cost $X` | Stop after spending $X |
| `--max-duration 2h` | Stop after time elapsed |
| `--merge-strategy squash` | squash, merge, or rebase |
| `--worktree <name>` | Parallel execution via git worktrees |
| `--disable-commits` | Dry-run mode (no git operations) |
| `--review-prompt "..."` | Add reviewer pass per iteration |
| `--ci-retry-max N` | Auto-fix CI failures (default: 1) |

---

## 5. The De-Sloppify Pattern

**An add-on pattern for any loop.** Add a dedicated cleanup/refactor step after each Implementer step.

### The Problem

When you ask an LLM to implement with TDD, it takes "write tests" too literally:
- Tests that verify TypeScript's type system works (testing `typeof x === 'string'`)
- Overly defensive runtime checks for things the type system already guarantees
- Tests for framework behavior rather than business logic
- Excessive error handling that obscures the actual code

### Why Not Negative Instructions?

Adding "don't test type systems" or "don't add unnecessary checks" to the Implementer prompt has downstream effects:
- The model becomes hesitant about ALL testing
- It skips legitimate edge case tests
- Quality degrades unpredictably

### The Solution: Separate Pass

Instead of constraining the Implementer, let it be thorough. Then add a focused cleanup agent:

```bash
# Step 1: Implement (let it be thorough)
claude -p "Implement the feature with full TDD. Be thorough with tests."

# Step 2: De-sloppify (separate context, focused cleanup)
claude -p "Review all changes in the working tree. Remove:
- Tests that verify language/framework behavior rather than business logic
- Redundant type checks that the type system already enforces
- Over-defensive error handling for impossible states
- Console.log statements
- Commented-out code

Keep all business logic tests. Run the test suite after cleanup to ensure nothing breaks."
```

### In a Loop Context

```bash
for feature in "${features[@]}"; do
  # Implement
  claude -p "Implement $feature with TDD."

  # De-sloppify
  claude -p "Cleanup pass: review changes, remove test/code slop, run tests."

  # Verify
  claude -p "Run build + lint + tests. Fix any failures."

  # Commit
  claude -p "Commit with message: feat: add $feature"
done
```

### Key Insight

> Rather than adding negative instructions which have downstream quality effects, add a separate de-sloppify pass. Two focused agents outperform one constrained agent.

---

## 6. Ralphinho / RFC-Driven DAG Orchestration

**The most sophisticated pattern.** An RFC-driven, multi-agent pipeline that decomposes a spec into a dependency DAG, runs each unit through a tiered quality pipeline, and lands them via an agent-driven merge queue. Created by enitrat (credit: @enitrat).

### Architecture Overview

```
RFC/PRD Document
       │
       ▼
  DECOMPOSITION (AI)
  Break RFC into work units with dependency DAG
       │
       ▼
┌──────────────────────────────────────────────────────┐
│  RALPH LOOP (up to 3 passes)                         │
│                                                      │
│  For each DAG layer (sequential, by dependency):     │
│                                                      │
│  ┌── Quality Pipelines (parallel per unit) ───────┐  │
│  │  Each unit in its own worktree:                │  │
│  │  Research → Plan → Implement → Test → Review   │  │
│  │  (depth varies by complexity tier)             │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌── Merge Queue ─────────────────────────────────┐  │
│  │  Rebase onto main → Run tests → Land or evict │  │
│  │  Evicted units re-enter with conflict context  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### RFC Decomposition

AI reads the RFC and produces work units:

```typescript
interface WorkUnit {
  id: string;              // kebab-case identifier
  name: string;            // Human-readable name
  rfcSections: string[];   // Which RFC sections this addresses
  description: string;     // Detailed description
  deps: string[];          // Dependencies (other unit IDs)
  acceptance: string[];    // Concrete acceptance criteria
  tier: "trivial" | "small" | "medium" | "large";
}
```

**Decomposition Rules:**
- Prefer fewer, cohesive units (minimize merge risk)
- Minimize cross-unit file overlap (avoid conflicts)
- Keep tests WITH implementation (never separate "implement X" + "test X")
- Dependencies only where real code dependency exists

The dependency DAG determines execution order:
```
Layer 0: [unit-a, unit-b]     ← no deps, run in parallel
Layer 1: [unit-c]             ← depends on unit-a
Layer 2: [unit-d, unit-e]     ← depend on unit-c
```

### Complexity Tiers

Different tiers get different pipeline depths:

| Tier | Pipeline Stages |
|------|----------------|
| **trivial** | implement → test |
| **small** | implement → test → code-review |
| **medium** | research → plan → implement → test → PRD-review + code-review → review-fix |
| **large** | research → plan → implement → test → PRD-review + code-review → review-fix → final-review |

This prevents expensive operations on simple changes while ensuring architectural changes get thorough scrutiny.

### Separate Context Windows (Author-Bias Elimination)

Each stage runs in its own agent process with its own context window:

| Stage | Model | Purpose |
|-------|-------|---------|
| Research | Sonnet | Read codebase + RFC, produce context doc |
| Plan | Opus | Design implementation steps |
| Implement | Codex | Write code following the plan |
| Test | Sonnet | Run build + test suite |
| PRD Review | Sonnet | Spec compliance check |
| Code Review | Opus | Quality + security check |
| Review Fix | Codex | Address review issues |
| Final Review | Opus | Quality gate (large tier only) |

**Critical design:** The reviewer never wrote the code it reviews. This eliminates author bias — the most common source of missed issues in self-review.

### Merge Queue with Eviction

After quality pipelines complete, units enter the merge queue:

```
Unit branch
    │
    ├─ Rebase onto main
    │   └─ Conflict? → EVICT (capture conflict context)
    │
    ├─ Run build + tests
    │   └─ Fail? → EVICT (capture test output)
    │
    └─ Pass → Fast-forward main, push, delete branch
```

**File Overlap Intelligence:**
- Non-overlapping units land speculatively in parallel
- Overlapping units land one-by-one, rebasing each time

**Eviction Recovery:**
When evicted, full context is captured (conflicting files, diffs, test output) and fed back to the implementer on the next Ralph pass:

```markdown
## MERGE CONFLICT — RESOLVE BEFORE NEXT LANDING

Your previous implementation conflicted with another unit that landed first.
Restructure your changes to avoid the conflicting files/lines below.

{full eviction context with diffs}
```

### Data Flow Between Stages

```
research.contextFilePath ──────────────────→ plan
plan.implementationSteps ──────────────────→ implement
implement.{filesCreated, whatWasDone} ─────→ test, reviews
test.failingSummary ───────────────────────→ reviews, implement (next pass)
reviews.{feedback, issues} ────────────────→ review-fix → implement (next pass)
final-review.reasoning ────────────────────→ implement (next pass)
evictionContext ───────────────────────────→ implement (after merge conflict)
```

### Worktree Isolation

Every unit runs in an isolated worktree (uses jj/Jujutsu, not git):
```
/tmp/workflow-wt-{unit-id}/
```

Pipeline stages for the same unit **share** a worktree, preserving state (context files, plan files, code changes) across research → plan → implement → test → review.

### Key Design Principles

1. **Deterministic execution** — Upfront decomposition locks in parallelism and ordering
2. **Human review at leverage points** — The work plan is the single highest-leverage intervention point
3. **Separate concerns** — Each stage in a separate context window with a separate agent
4. **Conflict recovery with context** — Full eviction context enables intelligent re-runs, not blind retries
5. **Tier-driven depth** — Trivial changes skip research/review; large changes get maximum scrutiny
6. **Resumable workflows** — Full state persisted to SQLite; resume from any point

### When to Use Ralphinho vs Simpler Patterns

| Signal | Use Ralphinho | Use Simpler Pattern |
|--------|--------------|-------------------|
| Multiple interdependent work units | Yes | No |
| Need parallel implementation | Yes | No |
| Merge conflicts likely | Yes | No (sequential is fine) |
| Single-file change | No | Yes (sequential pipeline) |
| Multi-day project | Yes | Maybe (continuous-claude) |
| Spec/RFC already written | Yes | Maybe |
| Quick iteration on one thing | No | Yes (NanoClaw or pipeline) |

---

## Choosing the Right Pattern

### Decision Matrix

```
Is the task a single focused change?
├─ Yes → Sequential Pipeline or NanoClaw
└─ No → Is there a written spec/RFC?
         ├─ Yes → Do you need parallel implementation?
         │        ├─ Yes → Ralphinho (DAG orchestration)
         │        └─ No → Continuous Claude (iterative PR loop)
         └─ No → Do you need many variations of the same thing?
                  ├─ Yes → Infinite Agentic Loop (spec-driven generation)
                  └─ No → Sequential Pipeline with de-sloppify
```

### Combining Patterns

These patterns compose well:

1. **Sequential Pipeline + De-Sloppify** — The most common combination. Every implement step gets a cleanup pass.

2. **Continuous Claude + De-Sloppify** — Add `--review-prompt` with a de-sloppify directive to each iteration.

3. **Any loop + Verification** — Use ECC's `/verify` command or `verification-loop` skill as a gate before commits.

4. **Ralphinho's tiered approach in simpler loops** — Even in a sequential pipeline, you can route simple tasks to Haiku and complex tasks to Opus:
   ```bash
   # Simple formatting fix
   claude -p --model haiku "Fix the import ordering in src/utils.ts"

   # Complex architectural change
   claude -p --model opus "Refactor the auth module to use the strategy pattern"
   ```

---

## Anti-Patterns

### Common Mistakes

1. **Infinite loops without exit conditions** — Always have a max-runs, max-cost, max-duration, or completion signal.

2. **No context bridge between iterations** — Each `claude -p` call starts fresh. Use `SHARED_TASK_NOTES.md` or filesystem state to bridge context.

3. **Retrying the same failure** — If an iteration fails, don't just retry. Capture the error context and feed it to the next attempt.

4. **Negative instructions instead of cleanup passes** — Don't say "don't do X." Add a separate pass that removes X.

5. **All agents in one context window** — For complex workflows, separate concerns into different agent processes. The reviewer should never be the author.

6. **Ignoring file overlap in parallel work** — If two parallel agents might edit the same file, you need a merge strategy (sequential landing, rebase, or conflict resolution).

---

## References

| Project | Author | Link |
|---------|--------|------|
| Ralphinho | enitrat | credit: @enitrat |
| Infinite Agentic Loop | disler | credit: @disler |
| Continuous Claude | AnandChowdhary | credit: @AnandChowdhary |
| NanoClaw | ECC | `/claw` command in this repo |
| Verification Loop | ECC | `skills/verification-loop/` in this repo |

---

## 9. ralphinho-rfc-pipeline

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/ralphinho-rfc-pipeline/SKILL.md

---
name: ralphinho-rfc-pipeline
description: RFC-driven multi-agent DAG execution pattern with quality gates, merge queues, and work unit orchestration.
origin: ECC
---

# Ralphinho RFC Pipeline

Inspired by [humanplane](https://github.com/humanplane) style RFC decomposition patterns and multi-unit orchestration workflows.

Use this skill when a feature is too large for a single agent pass and must be split into independently verifiable work units.

## Pipeline Stages

1. RFC intake
2. DAG decomposition
3. Unit assignment
4. Unit implementation
5. Unit validation
6. Merge queue and integration
7. Final system verification

## Unit Spec Template

Each work unit should include:
- `id`
- `depends_on`
- `scope`
- `acceptance_tests`
- `risk_level`
- `rollback_plan`

## Complexity Tiers

- Tier 1: isolated file edits, deterministic tests
- Tier 2: multi-file behavior changes, moderate integration risk
- Tier 3: schema/auth/perf/security changes

## Quality Pipeline per Unit

1. research
2. implementation plan
3. implementation
4. tests
5. review
6. merge-ready report

## Merge Queue Rules

- Never merge a unit with unresolved dependency failures.
- Always rebase unit branches on latest integration branch.
- Re-run integration tests after each queued merge.

## Recovery

If a unit stalls:
- evict from active queue
- snapshot findings
- regenerate narrowed unit scope
- retry with updated constraints

## Outputs

- RFC execution log
- unit scorecards
- dependency graph snapshot
- integration risk summary

---

## 10. plan-orchestrate

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/plan-orchestrate/SKILL.md

---
name: plan-orchestrate
description: Read a plan document, decompose it into steps, design a per-step agent chain from the ECC catalogue, and emit ready-to-paste /orchestrate custom prompts. Generative only — never invokes /orchestrate itself. Use when the user has a multi-step plan and wants to drive it through orchestrate without composing chains by hand.
origin: ECC
---

# Plan Orchestrate

Bridge a plan document to `/orchestrate custom` by emitting one ready-to-paste invocation per step. The skill is generative only — it never executes `/orchestrate`. The user pastes each line when ready.

## When to Activate

- User has a multi-step plan document (PRD, RFC, implementation plan) and wants to drive it through `/orchestrate`.
- User says "orchestrate this plan", "give me orchestrate prompts for each step", "compose chains for this plan".
- A step-by-step plan exists but the user does not want to manually pick agents per step.

Skip when:
- The work is one ad-hoc step → call `/orchestrate custom` directly.
- The plan is unreadable or empty. Lack of explicit numbering alone is not a skip condition — see the "No clear steps" edge case below.

## Inputs

```
<plan-doc-path> [--lang=python|typescript|go|rust|cpp|java|kotlin|flutter|auto] [--scope=all|step:<n>|range:<a>-<b>] [--dry-run]
```

- `<plan-doc-path>` — required; relative or absolute path (`@docs/...` accepted).
- `--lang` — reviewer language variant; defaults to `auto` (detected from project).
- `--scope` — limits emitted steps; defaults to `all`.
- `--dry-run` — print decomposition + chain rationale only; do not emit final prompts.

## Authoritative `/orchestrate` shape (do not deviate)

```
{ORCH_CMD} custom "<agent1>,<agent2>,...,<agentN>" "<task description>"
```

Where `{ORCH_CMD}` is determined in Phase 0 (see below). The command string in the emitted output **always uses one concrete form** — never both, never a placeholder.

- `custom` is a sequential chain; each agent's HANDOFF feeds the next.
- Comma-separated agent list. No spaces preferred; one space tolerated.
- No `--mode` / `--gate` / `--agents=...` flags exist — never invent them.
- Agent names come from the catalogue in this skill. Embedded double quotes in the task description are escaped as `\"`.

## ECC install form and namespacing

Two install forms determine the prefix on **both** the slash command and every agent name. The two MUST stay in sync — one form per output, never mixed:

Let `<claude-home>` denote the Claude Code home directory: `~/.claude` on macOS/Linux, `%USERPROFILE%\.claude` on Windows. Resolve it the way the host platform resolves the user home directory (do not hardcode `~`).

| Form | Detection | `{ORCH_CMD}` | Agent name format |
|---|---|---|---|
| Plugin install (1.9.0+) | `<claude-home>/plugins/marketplaces/everything-claude-code/` exists | `/everything-claude-code:orchestrate` | `everything-claude-code:<name>` |
| Legacy bare install | Above absent; agent files under `<claude-home>/agents/` | `/orchestrate` | `<name>` |

Why this matters: under the plugin install, agents register as `everything-claude-code:tdd-guide`. Bare names force fuzzy matching, which fails intermittently under parallel calls. Under legacy, the prefixed forms are not registered and fail outright.

## Available agent catalogue (must pick from these)

General:
- `planner` — requirement restatement, risk decomposition, step planning
- `architect` — architecture, system design, refactor proposals
- `tdd-guide` — write tests → implement → 80%+ coverage
- `code-reviewer` — generic code review
- `security-reviewer` — security audit, OWASP, secret leakage
- `refactor-cleaner` — dead code, duplicates, knip-class cleanup
- `doc-updater` — documentation, codemap, README
- `docs-lookup` — third-party library API lookups (Context7)
- `e2e-runner` — end-to-end test orchestration
- `database-reviewer` — PostgreSQL schema, migration, performance
- `harness-optimizer` — local agent harness configuration
- `loop-operator` — long-running autonomous loops
- `chief-of-staff` — multi-channel triage (rarely a fit for plan steps)

Build error resolvers:
- `build-error-resolver` (generic) / `cpp-build-resolver` / `go-build-resolver` / `java-build-resolver` / `kotlin-build-resolver` / `rust-build-resolver` / `pytorch-build-resolver`

Code reviewers:
- `python-reviewer` / `typescript-reviewer` / `go-reviewer` / `rust-reviewer` / `cpp-reviewer` / `java-reviewer` / `kotlin-reviewer` / `flutter-reviewer`

A misspelled agent name fails `/orchestrate`. Cross-check against this list before emitting.

## How It Works

### Phase 0 — Detect ECC mode + language

1. Read `<plan-doc-path>`. If missing or empty, report and stop.
2. Detect ECC install form once and freeze it into `ECC_MODE`. Algorithm (run in order, stop at the first match):
   1. If `<claude-home>/plugins/marketplaces/everything-claude-code/` exists → `ECC_MODE=plugin`.
   2. Else if `<claude-home>/agents/` exists and contains at least one ECC agent file (e.g. `tdd-guide.md`, `code-reviewer.md`) → `ECC_MODE=legacy`.
   3. Else → default to `ECC_MODE=legacy` and emit a one-line warning at the top of the output: `> Warning: could not detect ECC install; defaulting to legacy form. If you use the plugin install, edit the prefixes manually.`
   4. If both markers exist (mixed install), `plugin` wins — the plugin namespace is the only one that resolves agent names without fuzzy matching.

   From this point on, every emitted line uses the matching prefix on **both** the slash command and every agent name. **Never emit both forms in the same output.**
3. Resolve `--lang`. When `auto`, run a polyglot-aware detection:
   - Probe markers: `pyproject.toml` / `uv.lock` / `requirements.txt` → python; `package.json` → typescript; `go.mod` → go; `Cargo.toml` → rust; `CMakeLists.txt` or top-level `*.cpp` → cpp; `pom.xml` / `build.gradle` (Java) → java; `build.gradle.kts` or top-level Kotlin → kotlin; `pubspec.yaml` → flutter.
   - **Polyglot tie-break**: if more than one marker matches, pick the language whose source files outnumber the others (count via `git ls-files`, excluding `vendor/`, `node_modules/`, `dist/`, `build/`, `.venv/`, generated files, and obvious test fixtures). On a tie or when no language exceeds 60% of source files, set `lang=unknown`.
   - No marker matched → set `lang=unknown`.
   - `lang=unknown` is a sentinel — it is **not** an agent name. Phase 2 rules 4 and 5 turn it into `code-reviewer` / `build-error-resolver` at chain composition time.
4. Detect a **PyTorch sub-profile**: when `lang=python` and any of `pyproject.toml` / `requirements.txt` / `uv.lock` declares a dependency on `torch`, set `pytorch=true`. This only affects `build` chain selection (Phase 2 rule below); the reviewer remains `python-reviewer`.
5. **Normalize any agent names declared in the plan**: if the plan text references agents by their plugin-prefixed form (e.g. `everything-claude-code:tdd-guide`), strip the prefix to get the bare catalogue name before validating or composing chains. Re-prefixing happens only at output time per `ECC_MODE` (Phase 4). Never let a pre-prefixed name flow into chain composition — it would double-prefix in plugin mode.

### Phase 1 — Decompose steps

Identify "step units" in priority order:

1. Explicit numbering: `## Step N` / `### Phase N` / `## N. ...` / top-level ordered list.
2. A "Step" column in a table.
3. `---`-separated blocks with verb-led headings.
4. Otherwise treat each H2 as one step.

Per step extract `id` (1-based), `title` (≤ 80 chars), `intent` (1–3 sentences), `tags`.

### Phase 2 — Tag and pick chain

Tag by intent (multi-tag allowed; chain built from primary + stacked secondaries):

Trigger words below are matched case-insensitively. Multilingual plans are supported by matching the word stems in any language as long as the meaning aligns with the listed English trigger words.

| Tag | Trigger words | Default chain |
|---|---|---|
| `design` | architecture, design, choose, evaluate, RFC | `planner,architect` |
| `plan` | plan, breakdown, milestone | `planner` |
| `impl` | implement, build, add, create, port | `tdd-guide,<lang>-reviewer` |
| `test` | test, coverage, e2e, integration | `tdd-guide,e2e-runner` |
| `refactor` | refactor, cleanup, dedupe, split | `architect,refactor-cleaner,<lang>-reviewer` |
| `migration` | migrate, upgrade, rewrite, port | `architect,tdd-guide,<lang>-reviewer` |
| `db` | schema, migration, index, SQL, Postgres, alembic, sqlmodel | `database-reviewer,<lang>-reviewer` |
| `security` | encrypt, auth, secret, OWASP, PII | `security-reviewer,<lang>-reviewer` |
| `build` | build, compile, lint failure, CI | `<lang>-build-resolver` (falls back to `build-error-resolver`) |
| `docs` | docs, readme, codemap, changelog | `doc-updater` |
| `lookup` | lookup, reference, API usage | `docs-lookup` |
| `review` | review, audit, verify | `<lang>-reviewer,code-reviewer` |
| `loop` | loop, autonomous, watchdog | `loop-operator` |

Chain composition rules:
1. **Primary tag selection**: when a step matches multiple tags, the **first one in table order** (top of the table = highest priority) is the primary; the rest are secondaries. Composition rules 2 and 3 below handle specific multi-tag combinations explicitly; otherwise, append secondary chains in tag table order.
2. `impl` + `security` → `tdd-guide,<lang>-reviewer,security-reviewer`.
3. `impl` + `db` → `tdd-guide,database-reviewer,<lang>-reviewer`.
4. **Deduplicate** the resulting chain (preserve first occurrence). E.g. `review` + `lang=unknown` would yield `code-reviewer,code-reviewer` after rule 5; deduplication collapses it to `code-reviewer`.
5. `<lang>-reviewer` resolves to `code-reviewer` when `lang=unknown`.
6. `<lang>-build-resolver` resolves to `build-error-resolver` when `lang=unknown`. **Special case**: if Phase 0 set `pytorch=true`, use `pytorch-build-resolver` for `build` chains regardless of `<lang>`. There is no `python-build-resolver`; `--lang=python` without `pytorch=true` resolves to `build-error-resolver`.
7. **Zero-tag steps**: if no trigger word matches, set chain to `code-reviewer` and write `no tag matched; default review-only chain` under "Chain rationale".
8. Chain length ≤ 4 after deduplication. If exceeded, drop weakest tag (`lookup` and `docs` first).
9. Do not pair `planner` and `architect` in an `impl` chain (token waste). Pair them only on `design` steps.
10. Steps tagged `impl`, `refactor`, or `migration` end with a **reviewer-class** agent — any of `<lang>-reviewer`, `code-reviewer`, `security-reviewer`, or `database-reviewer`. The most domain-specific reviewer wins the tail position (e.g. rule 2's `impl+security` ends with `security-reviewer`; rule 3's `impl+db` ends with `<lang>-reviewer` because `database-reviewer` already gates the migration earlier in the chain). `test` and `build` steps are gated by their own validators (`e2e-runner` and the build resolver respectively) and do not require an additional reviewer.

### Phase 3 — Compress task description

Each emitted `<task description>` must:
- Be self-contained (the first agent does not need the plan document open).
- Start with `[Plan: <path>#step-<id>]`.
- Include 1–3 verifiable Acceptance criteria.
- Include a Scope guard (`Out of scope: ...`) **only if the plan declares one for this step**. Inherit verbatim. If the plan has no out-of-scope statement, omit the clause entirely — do not invent one.
- Be 200–600 characters; one line; embedded `"` escaped as `\"`; no literal newlines.

### Phase 4 — Output

Emit Markdown using **the form determined by `ECC_MODE`**. The output uses one form throughout — every `{ORCH_CMD}` and every agent name is rendered with the matching prefix from Phase 0. **Do not emit both forms; do not include "this is plugin form" / "strip the prefix" instructions in the rendered output.**

Concrete rendering rules:

- `{ORCH_CMD}` = `/everything-claude-code:orchestrate` under `plugin`, `/orchestrate` under `legacy`.
- `{AGENT(name)}` = `everything-claude-code:<name>` under `plugin`, `<name>` under `legacy`.
- The overview-table "Chain" column uses the same `{AGENT(name)}` rendering.
- Per-step bash blocks contain only the runnable command. **No `# plugin form` or `# legacy form` comments** — the form is implicit and uniform across the whole output.

Output structure:

````markdown
# Plan-Orchestrate Result

**Plan**: `<path>`
**Lang**: `<detected-or-given>`
**ECC mode**: `<plugin | legacy>`
**Steps**: <N>
**Scope**: <all | step:n | range:a-b>

## Steps overview

| # | Title | Tags | Chain |
|---|---|---|---|
| 1 | ... | impl, db | `{AGENT(tdd-guide)},{AGENT(database-reviewer)},{AGENT(python-reviewer)}` |
| ... | | | |

---

## Step 1 — <title>

**Intent**: <1–3 sentences>
**Tags**: <a, b>
**Chain rationale**: <why this chain; which agent closes the loop>

```bash
{ORCH_CMD} custom "{AGENT(tdd-guide)},{AGENT(database-reviewer)},{AGENT(python-reviewer)}" "[Plan: docs/foo.md#step-1] <compressed task description>; Acceptance: <1–3 items>; Out of scope: <…>"
```
````

> The `{ORCH_CMD}` and `{AGENT(...)}` notation above describes the substitution this skill performs at runtime. The actual emitted Markdown contains the resolved strings, never the placeholders.

Append a final "Batch execution" block aggregating every step's command in order so the user can paste them all at once. **Skip the Batch block in overview-only mode** (see "Large plan" edge case): when only the overview table is being emitted, there are no per-step commands to aggregate.

### Phase 5 — Self-check (run before emitting)

- [ ] Every agent in every chain comes from the catalogue (after stripping any `everything-claude-code:` prefix that appeared in the plan; see Phase 0 step 5).
- [ ] Resolved `{ORCH_CMD}` and every resolved `{AGENT(...)}` use the **same** form (`plugin` or `legacy`) — never mixed in one output.
- [ ] No `# plugin form` / `# legacy form` annotations and no "strip the prefix" instructions remain in the rendered output.
- [ ] No invented `--mode` / `--gate` / `--agents=...` fields.
- [ ] Each task description is single-line, double-quoted, with embedded `"` escaped.
- [ ] Each task description begins with `[Plan: <path>#step-<id>]` and includes Acceptance (1–3 items). The `Out of scope:` clause is present only when inherited from the plan.
- [ ] No duplicate agent in any chain after Phase 2 dedup.
- [ ] Chain length ≤ 4.
- [ ] Steps tagged `impl`/`refactor`/`migration` end with a reviewer-class agent (`<lang>-reviewer`, `code-reviewer`, `security-reviewer`, or `database-reviewer`). `test` and `build` are exempt — see Phase 2 rule 10.
- [ ] Zero-tag steps emit `code-reviewer` with the rationale `no tag matched; default review-only chain`.
- [ ] Overview table lists every step in the plan, regardless of `--scope`.
- [ ] Per-step detail block count matches the resolved `--scope` (full plan when `--scope=all`; one block for `step:n`; range size for `range:a-b`). In overview-only mode, no per-step blocks and no Batch block are emitted.

## Edge cases

- **No clear steps**: prefer H2/H3 splitting; if still ambiguous, report "no structured steps detected" with the document outline and ask the user to confirm running by outline.
- **Large plan (>1500 lines)**: enter **overview-only mode** — emit only the overview table and ask the user to narrow with `--scope` before re-running for details. In this mode, skip per-step detail blocks and skip the Batch execution block.
- **Step too broad** (e.g. "complete all backend work"): do not force a single chain. Suggest splitting into N.a and N.b and propose a split.
- **Plan declares agents** (rare): first **strip any `everything-claude-code:` prefix** to get the bare catalogue name (Phase 0 step 5), then validate against the catalogue. Replace invalid agents and explain under "Chain rationale". The bare name is re-prefixed at output time per `ECC_MODE`.
- **Polyglot project where `--lang=auto` cannot pick a winner**: set `lang=unknown`; reviewer resolves to `code-reviewer` and build resolver to `build-error-resolver`. Mention the fallback under "Chain rationale".

## Examples

### Example 1 — Plugin mode, Python plan

Input:
```
plan-orchestrate @docs/plan/example-feature.md --lang=python
```

Excerpt of expected output:
````markdown
## Step 2 — Encrypt sensitive UserProfile fields

**Intent**: Introduce an `EncryptedString` SQLAlchemy type and AES-GCM encrypt `birth_datetime` / `location` before persistence; load the key from an environment variable.
**Tags**: impl, security, db
**Chain rationale**: Security-sensitive write path, so `security-reviewer` closes the chain; `database-reviewer` validates the alembic migration; `python-reviewer` covers typing and PEP 8.

```bash
/everything-claude-code:orchestrate custom "everything-claude-code:tdd-guide,everything-claude-code:database-reviewer,everything-claude-code:python-reviewer,everything-claude-code:security-reviewer" "[Plan: docs/plan/example-feature.md#step-2] Implement EncryptedString SQLAlchemy type and migrate UserProfile.birth_datetime/location columns; key from ENV APP_DB_KEY; Acceptance: encrypt/decrypt roundtrip tests pass; alembic upgrade/downgrade clean on empty DB; no plaintext in DB after migrate; Out of scope: cross-tenant profile sharing logic"
```
````

### Example 2 — Legacy mode, same step

If `ECC_MODE=legacy` were detected, the same step would be emitted as a single uniform command (no plugin-prefixed forms anywhere in the output):

```bash
/orchestrate custom "tdd-guide,database-reviewer,python-reviewer,security-reviewer" "[Plan: docs/plan/example-feature.md#step-2] ..."
```

The two examples above illustrate **the two possible outputs** for two different environments. A single skill invocation produces only one of them, end to end.

## Notes

- Generative only. Never invoke `/orchestrate` from inside this skill.
- Match the language of the plan document for task descriptions (agent names always remain English).
- Do not insert "Co-Authored-By" lines or emoji in the output unless the user explicitly asks.

---

## 11. team-builder

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/team-builder/SKILL.md

---
name: team-builder
description: Interactive agent picker for composing and dispatching parallel teams
origin: community
---

# Team Builder

Interactive menu for browsing and composing agent teams on demand. Works with flat or domain-subdirectory agent collections.

## When to Use

- You have multiple agent personas (markdown files) and want to pick which ones to use for a task
- You want to compose an ad-hoc team from different domains (e.g., Security + SEO + Architecture)
- You want to browse what agents are available before deciding

## Prerequisites

Agent files must be markdown files containing a persona prompt (identity, rules, workflow, deliverables). The first `# Heading` is used as the agent name and the first paragraph as the description.

Both flat and subdirectory layouts are supported:

**Subdirectory layout** — domain is inferred from the folder name:

```
agents/
├── engineering/
│   ├── security-engineer.md
│   └── software-architect.md
├── marketing/
│   └── seo-specialist.md
└── sales/
    └── discovery-coach.md
```

**Flat layout** — domain inferred from shared filename prefixes. A prefix counts as a domain when 2+ files share it. Files with unique prefixes go to "General". Note: the algorithm splits at the first `-`, so multi-word domains (e.g., `product-management`) should use the subdirectory layout instead:

```
agents/
├── engineering-security-engineer.md
├── engineering-software-architect.md
├── marketing-seo-specialist.md
├── marketing-content-strategist.md
├── sales-discovery-coach.md
└── sales-outbound-strategist.md
```

## Configuration

Agents are discovered via two methods, merged and deduplicated by agent name:

1. **`claude agents` command** (primary) — run `claude agents` to get all agents known to the CLI, including user agents, plugin agents (e.g. `everything-claude-code:architect`), and built-in agents. This automatically covers ECC marketplace installs without any path configuration.
2. **File glob** (fallback, for reading agent content) — agent markdown files are read from:
   - `./agents/**/*.md` + `./agents/*.md` — project-local agents
   - `~/.claude/agents/**/*.md` + `~/.claude/agents/*.md` — global user agents

Earlier sources take precedence when names collide: user agents > plugin agents > built-in agents. A custom path can be used instead if the user specifies one.

## How It Works

### Step 1: Discover Available Agents

Run `claude agents` to get the full agent list. Parse each line:
- **Plugin agents** are prefixed with `plugin-name:` (e.g., `everything-claude-code:security-reviewer`). Use the part after `:` as the agent name and the plugin name as the domain.
- **User agents** have no prefix. Read the corresponding markdown file from `~/.claude/agents/` or `./agents/` to extract the name and description.
- **Built-in agents** (e.g., `Explore`, `Plan`) are skipped unless the user explicitly asks to include them.

For user agents loaded from markdown files:
- **Subdirectory layout:** extract the domain from the parent folder name
- **Flat layout:** collect all filename prefixes (text before the first `-`). A prefix qualifies as a domain only if it appears in 2 or more filenames (e.g., `engineering-security-engineer.md` and `engineering-software-architect.md` both start with `engineering` → Engineering domain). Files with unique prefixes (e.g., `code-reviewer.md`, `tdd-guide.md`) are grouped under "General"
- Extract the agent name from the first `# Heading`. If no heading is found, derive the name from the filename (strip `.md`, replace hyphens with spaces, title-case)
- Extract a one-line summary from the first paragraph after the heading

If no agents are found after running `claude agents` and probing file locations, inform the user: "No agents found. Run `claude agents` to verify your setup." Then stop.

### Step 2: Present Domain Menu

```
Available agent domains:
1. Engineering — Software Architect, Security Engineer
2. Marketing — SEO Specialist
3. Sales — Discovery Coach, Outbound Strategist

Pick domains or name specific agents (e.g., "1,3" or "security + seo"):
```

- Skip domains with zero agents (empty directories)
- Show agent count per domain

### Step 3: Handle Selection

Accept flexible input:
- Numbers: "1,3" selects all agents from Engineering and Sales
- Names: "security + seo" fuzzy-matches against discovered agents
- "all from engineering" selects every agent in that domain

If more than 5 agents are selected, list them alphabetically and ask the user to narrow down: "You selected N agents (max 5). Pick which to keep, or say 'first 5' to use the first five alphabetically."

Confirm selection:
```
Selected: Security Engineer + SEO Specialist
What should they work on? (describe the task):
```

### Step 4: Spawn Agents in Parallel

1. Read each selected agent's markdown file
2. Prompt for the task description if not already provided
3. Spawn all agents in parallel using the Agent tool:
   - `subagent_type: "general-purpose"`
   - `prompt: "{agent file content}\n\nTask: {task description}"`
   - Each agent runs independently — no inter-agent communication needed
4. If an agent fails (error, timeout, or empty output), note the failure inline (e.g., "Security Engineer: failed — [reason]") and continue with results from agents that succeeded

### Step 5: Synthesize Results

Collect all outputs and present a unified report:
- Results grouped by agent
- Synthesis section highlighting:
  - Agreements across agents
  - Conflicts or tensions between recommendations
  - Recommended next steps

If only 1 agent was selected, skip synthesis and present the output directly.

## Rules

- **Dynamic discovery only.** Never hardcode agent lists. New files in the directory auto-appear in the menu.
- **Max 5 agents per team.** More than 5 produces diminishing returns and excessive token usage. Enforce at selection time.
- **Parallel dispatch.** All agents run simultaneously — use the Agent tool's parallel invocation pattern.
- **Parallel Agent calls, not TeamCreate.** This skill uses parallel Agent tool calls for independent work. TeamCreate (a Claude Code tool for multi-agent dialogue) is only needed when agents must debate or respond to each other.

## Examples

```
User: team builder

Claude:
Available agent domains:
1. Engineering (2) — Software Architect, Security Engineer
2. Marketing (1) — SEO Specialist
3. Sales (4) — Discovery Coach, Outbound Strategist, Proposal Strategist, Sales Engineer
4. Support (1) — Executive Summary

Pick domains or name specific agents:

User: security + seo

Claude:
Selected: Security Engineer + SEO Specialist
What should they work on?

User: Review my Next.js e-commerce site before launch

[Both agents spawn in parallel, each applying their specialty to the codebase]

Claude:
## Security Engineer Findings
- [findings...]

## SEO Specialist Findings
- [findings...]

## Synthesis
Both agents agree on: [...]
Tension: Security recommends CSP that blocks inline styles, SEO needs inline schema markup. Resolution: [...]
Next steps: [...]
```

---

## 12. dmux-workflows

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/dmux-workflows/SKILL.md

---
name: dmux-workflows
description: Multi-agent orchestration using dmux (tmux pane manager for AI agents). Patterns for parallel agent workflows across Claude Code, Codex, OpenCode, and other harnesses. Use when running multiple agent sessions in parallel or coordinating multi-agent development workflows.
origin: ECC
---

# dmux Workflows

Orchestrate parallel AI agent sessions using dmux, a tmux pane manager for agent harnesses.

## When to Activate

- Running multiple agent sessions in parallel
- Coordinating work across Claude Code, Codex, and other harnesses
- Complex tasks that benefit from divide-and-conquer parallelism
- User says "run in parallel", "split this work", "use dmux", or "multi-agent"

## What is dmux

dmux is a tmux-based orchestration tool that manages AI agent panes:
- Press `n` to create a new pane with a prompt
- Press `m` to merge pane output back to the main session
- Supports: Claude Code, Codex, OpenCode, Cline, Gemini, Qwen

**Install:** Install dmux from its repository after reviewing the package. See [github.com/standardagents/dmux](https://github.com/standardagents/dmux)

## Quick Start

```bash
# Start dmux session
dmux

# Create agent panes (press 'n' in dmux, then type prompt)
# Pane 1: "Implement the auth middleware in src/auth/"
# Pane 2: "Write tests for the user service"
# Pane 3: "Update API documentation"

# Each pane runs its own agent session
# Press 'm' to merge results back
```

## Workflow Patterns

### Pattern 1: Research + Implement

Split research and implementation into parallel tracks:

```
Pane 1 (Research): "Research best practices for rate limiting in Node.js.
  Check current libraries, compare approaches, and write findings to
  /tmp/rate-limit-research.md"

Pane 2 (Implement): "Implement rate limiting middleware for our Express API.
  Start with a basic token bucket, we'll refine after research completes."

# After Pane 1 completes, merge findings into Pane 2's context
```

### Pattern 2: Multi-File Feature

Parallelize work across independent files:

```
Pane 1: "Create the database schema and migrations for the billing feature"
Pane 2: "Build the billing API endpoints in src/api/billing/"
Pane 3: "Create the billing dashboard UI components"

# Merge all, then do integration in main pane
```

### Pattern 3: Test + Fix Loop

Run tests in one pane, fix in another:

```
Pane 1 (Watcher): "Run the test suite in watch mode. When tests fail,
  summarize the failures."

Pane 2 (Fixer): "Fix failing tests based on the error output from pane 1"
```

### Pattern 4: Cross-Harness

Use different AI tools for different tasks:

```
Pane 1 (Claude Code): "Review the security of the auth module"
Pane 2 (Codex): "Refactor the utility functions for performance"
Pane 3 (Claude Code): "Write E2E tests for the checkout flow"
```

### Pattern 5: Code Review Pipeline

Parallel review perspectives:

```
Pane 1: "Review src/api/ for security vulnerabilities"
Pane 2: "Review src/api/ for performance issues"
Pane 3: "Review src/api/ for test coverage gaps"

# Merge all reviews into a single report
```

## Best Practices

1. **Independent tasks only.** Don't parallelize tasks that depend on each other's output.
2. **Clear boundaries.** Each pane should work on distinct files or concerns.
3. **Merge strategically.** Review pane output before merging to avoid conflicts.
4. **Use git worktrees.** For file-conflict-prone work, use separate worktrees per pane.
5. **Resource awareness.** Each pane uses API tokens — keep total panes under 5-6.

## Git Worktree Integration

For tasks that touch overlapping files:

```bash
# Create worktrees for isolation
git worktree add -b feat/auth ../feature-auth HEAD
git worktree add -b feat/billing ../feature-billing HEAD

# Run agents in separate worktrees
# Pane 1: cd ../feature-auth && claude
# Pane 2: cd ../feature-billing && claude

# Merge branches when done
git merge feat/auth
git merge feat/billing
```

## Complementary Tools

| Tool | What It Does | When to Use |
|------|-------------|-------------|
| **dmux** | tmux pane management for agents | Parallel agent sessions |
| **Superset** | Terminal IDE for 10+ parallel agents | Large-scale orchestration |
| **Claude Code Task tool** | In-process subagent spawning | Programmatic parallelism within a session |
| **Codex multi-agent** | Built-in agent roles | Codex-specific parallel work |

## ECC Helper

ECC now includes a helper for external tmux-pane orchestration with separate git worktrees:

```bash
node scripts/orchestrate-worktrees.js plan.json --execute
```

Example `plan.json`:

```json
{
  "sessionName": "skill-audit",
  "baseRef": "HEAD",
  "launcherCommand": "codex exec --cwd {worktree_path} --task-file {task_file}",
  "workers": [
    { "name": "docs-a", "task": "Fix skills 1-4 and write handoff notes." },
    { "name": "docs-b", "task": "Fix skills 5-8 and write handoff notes." }
  ]
}
```

The helper:
- Creates one branch-backed git worktree per worker
- Optionally overlays selected `seedPaths` from the main checkout into each worker worktree
- Writes per-worker `task.md`, `handoff.md`, and `status.md` files under `.orchestration/<session>/`
- Starts a tmux session with one pane per worker
- Launches each worker command in its own pane
- Leaves the main pane free for the orchestrator

Use `seedPaths` when workers need access to dirty or untracked local files that are not yet part of `HEAD`, such as local orchestration scripts, draft plans, or docs:

```json
{
  "sessionName": "workflow-e2e",
  "seedPaths": [
    "scripts/orchestrate-worktrees.js",
    "scripts/lib/tmux-worktree-orchestrator.js",
    ".claude/plan/workflow-e2e-test.json"
  ],
  "launcherCommand": "bash {repo_root}/scripts/orchestrate-codex-worker.sh {task_file} {handoff_file} {status_file}",
  "workers": [
    { "name": "seed-check", "task": "Verify seeded files are present before starting work." }
  ]
}
```

## Troubleshooting

- **Pane not responding:** Switch to the pane directly or inspect it with `tmux capture-pane -pt <session>:0.<pane-index>`.
- **Merge conflicts:** Use git worktrees to isolate file changes per pane.
- **High token usage:** Reduce number of parallel panes. Each pane is a full agent session.
- **tmux not found:** Install with `brew install tmux` (macOS) or `apt install tmux` (Linux).

---

## 13. claude-devfleet

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/claude-devfleet/SKILL.md

---
name: claude-devfleet
description: Orchestrate multi-agent coding tasks via Claude DevFleet — plan projects, dispatch parallel agents in isolated worktrees, monitor progress, and read structured reports.
origin: community
---

# Claude DevFleet Multi-Agent Orchestration

## When to Use

Use this skill when you need to dispatch multiple Claude Code agents to work on coding tasks in parallel. Each agent runs in an isolated git worktree with full tooling.

Requires a running Claude DevFleet instance connected via MCP:
```bash
claude mcp add devfleet --transport http http://localhost:18801/mcp
```

## How It Works

```
User → "Build a REST API with auth and tests"
  ↓
plan_project(prompt) → project_id + mission DAG
  ↓
Show plan to user → get approval
  ↓
dispatch_mission(M1) → Agent 1 spawns in worktree
  ↓
M1 completes → auto-merge → auto-dispatch M2 (depends_on M1)
  ↓
M2 completes → auto-merge
  ↓
get_report(M2) → files_changed, what_done, errors, next_steps
  ↓
Report back to user
```

### Tools

| Tool | Purpose |
|------|---------|
| `plan_project(prompt)` | AI breaks a description into a project with chained missions |
| `create_project(name, path?, description?)` | Create a project manually, returns `project_id` |
| `create_mission(project_id, title, prompt, depends_on?, auto_dispatch?)` | Add a mission. `depends_on` is a list of mission ID strings (e.g., `["abc-123"]`). Set `auto_dispatch=true` to auto-start when deps are met. |
| `dispatch_mission(mission_id, model?, max_turns?)` | Start an agent on a mission |
| `cancel_mission(mission_id)` | Stop a running agent |
| `wait_for_mission(mission_id, timeout_seconds?)` | Block until a mission completes (see note below) |
| `get_mission_status(mission_id)` | Check mission progress without blocking |
| `get_report(mission_id)` | Read structured report (files changed, tested, errors, next steps) |
| `get_dashboard()` | System overview: running agents, stats, recent activity |
| `list_projects()` | Browse all projects |
| `list_missions(project_id, status?)` | List missions in a project |

> **Note on `wait_for_mission`:** This blocks the conversation for up to `timeout_seconds` (default 600). For long-running missions, prefer polling with `get_mission_status` every 30–60 seconds instead, so the user sees progress updates.

### Workflow: Plan → Dispatch → Monitor → Report

1. **Plan**: Call `plan_project(prompt="...")` → returns `project_id` + list of missions with `depends_on` chains and `auto_dispatch=true`.
2. **Show plan**: Present mission titles, types, and dependency chain to the user.
3. **Dispatch**: Call `dispatch_mission(mission_id=<first_mission_id>)` on the root mission (empty `depends_on`). Remaining missions auto-dispatch as their dependencies complete (because `plan_project` sets `auto_dispatch=true` on them).
4. **Monitor**: Call `get_mission_status(mission_id=...)` or `get_dashboard()` to check progress.
5. **Report**: Call `get_report(mission_id=...)` when missions complete. Share highlights with the user.

### Concurrency

DevFleet runs up to 3 concurrent agents by default (configurable via `DEVFLEET_MAX_AGENTS`). When all slots are full, missions with `auto_dispatch=true` queue in the mission watcher and dispatch automatically as slots free up. Check `get_dashboard()` for current slot usage.

## Examples

### Full auto: plan and launch

1. `plan_project(prompt="...")` → shows plan with missions and dependencies.
2. Dispatch the first mission (the one with empty `depends_on`).
3. Remaining missions auto-dispatch as dependencies resolve (they have `auto_dispatch=true`).
4. Report back with project ID and mission count so the user knows what was launched.
5. Poll with `get_mission_status` or `get_dashboard()` periodically until all missions reach a terminal state (`completed`, `failed`, or `cancelled`).
6. `get_report(mission_id=...)` for each terminal mission — summarize successes and call out failures with errors and next steps.

### Manual: step-by-step control

1. `create_project(name="My Project")` → returns `project_id`.
2. `create_mission(project_id=project_id, title="...", prompt="...", auto_dispatch=true)` for the first (root) mission → capture `root_mission_id`.
   `create_mission(project_id=project_id, title="...", prompt="...", auto_dispatch=true, depends_on=["<root_mission_id>"])` for each subsequent task.
3. `dispatch_mission(mission_id=...)` on the first mission to start the chain.
4. `get_report(mission_id=...)` when done.

### Sequential with review

1. `create_project(name="...")` → get `project_id`.
2. `create_mission(project_id=project_id, title="Implement feature", prompt="...")` → get `impl_mission_id`.
3. `dispatch_mission(mission_id=impl_mission_id)`, then poll with `get_mission_status` until complete.
4. `get_report(mission_id=impl_mission_id)` to review results.
5. `create_mission(project_id=project_id, title="Review", prompt="...", depends_on=[impl_mission_id], auto_dispatch=true)` — auto-starts since the dependency is already met.

## Guidelines

- Always confirm the plan with the user before dispatching, unless they said to go ahead.
- Include mission titles and IDs when reporting status.
- If a mission fails, read its report before retrying.
- Check `get_dashboard()` for agent slot availability before bulk dispatching.
- Mission dependencies form a DAG — do not create circular dependencies.
- Each agent runs in an isolated git worktree and auto-merges on completion. If a merge conflict occurs, the changes remain on the agent's worktree branch for manual resolution.
- When manually creating missions, always set `auto_dispatch=true` if you want them to trigger automatically when dependencies complete. Without this flag, missions stay in `draft` status.

---

## 14. council

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/council/SKILL.md

---
name: council
description: Convene a four-voice council for ambiguous decisions, tradeoffs, and go/no-go calls. Use when multiple valid paths exist and you need structured disagreement before choosing.
origin: ECC
---

# Council

Convene four advisors for ambiguous decisions:
- the in-context Claude voice
- a Skeptic subagent
- a Pragmatist subagent
- a Critic subagent

This is for **decision-making under ambiguity**, not code review, implementation planning, or architecture design.

## When to Use

Use council when:
- a decision has multiple credible paths and no obvious winner
- you need explicit tradeoff surfacing
- the user asks for second opinions, dissent, or multiple perspectives
- conversational anchoring is a real risk
- a go / no-go call would benefit from adversarial challenge

Examples:
- monorepo vs polyrepo
- ship now vs hold for polish
- feature flag vs full rollout
- simplify scope vs keep strategic breadth

## When NOT to Use

| Instead of council | Use |
| --- | --- |
| Verifying whether output is correct | `santa-method` |
| Breaking a feature into implementation steps | `planner` |
| Designing system architecture | `architect` |
| Reviewing code for bugs or security | `code-reviewer` or `santa-method` |
| Straight factual questions | just answer directly |
| Obvious execution tasks | just do the task |

## Roles

| Voice | Lens |
| --- | --- |
| Architect | correctness, maintainability, long-term implications |
| Skeptic | premise challenge, simplification, assumption breaking |
| Pragmatist | shipping speed, user impact, operational reality |
| Critic | edge cases, downside risk, failure modes |

The three external voices should be launched as fresh subagents with **only the question and relevant context**, not the full ongoing conversation. That is the anti-anchoring mechanism.

## Workflow

### 1. Extract the real question

Reduce the decision to one explicit prompt:
- what are we deciding?
- what constraints matter?
- what counts as success?

If the question is vague, ask one clarifying question before convening the council.

### 2. Gather only the necessary context

If the decision is codebase-specific:
- collect the relevant files, snippets, issue text, or metrics
- keep it compact
- include only the context needed to make the decision

If the decision is strategic/general:
- skip repo snippets unless they materially change the answer

### 3. Form the Architect position first

Before reading other voices, write down:
- your initial position
- the three strongest reasons for it
- the main risk in your preferred path

Do this first so the synthesis does not simply mirror the external voices.

### 4. Launch three independent voices in parallel

Each subagent gets:
- the decision question
- compact context if needed
- a strict role
- no unnecessary conversation history

Prompt shape:

```text
You are the [ROLE] on a four-voice decision council.

Question:
[decision question]

Context:
[only the relevant snippets or constraints]

Respond with:
1. Position — 1-2 sentences
2. Reasoning — 3 concise bullets
3. Risk — biggest risk in your recommendation
4. Surprise — one thing the other voices may miss

Be direct. No hedging. Keep it under 300 words.
```

Role emphasis:
- Skeptic: challenge framing, question assumptions, propose the simplest credible alternative
- Pragmatist: optimize for speed, simplicity, and real-world execution
- Critic: surface downside risk, edge cases, and reasons the plan could fail

### 5. Synthesize with bias guardrails

You are both a participant and the synthesizer, so use these rules:
- do not dismiss an external view without explaining why
- if an external voice changed your recommendation, say so explicitly
- always include the strongest dissent, even if you reject it
- if two voices align against your initial position, treat that as a real signal
- keep the raw positions visible before the verdict

### 6. Present a compact verdict

Use this output shape:

```markdown
## Council: [short decision title]

**Architect:** [1-2 sentence position]
[1 line on why]

**Skeptic:** [1-2 sentence position]
[1 line on why]

**Pragmatist:** [1-2 sentence position]
[1 line on why]

**Critic:** [1-2 sentence position]
[1 line on why]

### Verdict
- **Consensus:** [where they align]
- **Strongest dissent:** [most important disagreement]
- **Premise check:** [did the Skeptic challenge the question itself?]
- **Recommendation:** [the synthesized path]
```

Keep it scannable on a phone screen.

## Persistence Rule

Do **not** write ad-hoc notes to `~/.claude/notes` or other shadow paths from this skill.

If the council materially changes the recommendation:
- use `knowledge-ops` to store the lesson in the right durable location
- or use `/save-session` if the outcome belongs in session memory
- or update the relevant GitHub / Linear issue directly if the decision changes active execution truth

Only persist a decision when it changes something real.

## Multi-Round Follow-up

Default is one round.

If the user wants another round:
- keep the new question focused
- include the previous verdict only if it is necessary
- keep the Skeptic as clean as possible to preserve anti-anchoring value

## Anti-Patterns

- using council for code review
- using council when the task is just implementation work
- feeding the subagents the entire conversation transcript
- hiding disagreement in the final verdict
- persisting every decision as a note regardless of importance

## Related Skills

- `santa-method` — adversarial verification
- `knowledge-ops` — persist durable decision deltas correctly
- `search-first` — gather external reference material before the council if needed
- `architecture-decision-records` — formalize the outcome when the decision becomes long-lived system policy

## Example

Question:

```text
Should we ship ECC 2.0 as alpha now, or hold until the control-plane UI is more complete?
```

Likely council shape:
- Architect pushes for structural integrity and avoiding a confused surface
- Skeptic questions whether the UI is actually the gating factor
- Pragmatist asks what can be shipped now without harming trust
- Critic focuses on support burden, expectation debt, and rollout confusion

The value is not unanimity. The value is making the disagreement legible before choosing.

---

## 15. agent-eval

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-eval/SKILL.md

---
name: agent-eval
description: Head-to-head comparison of coding agents (Claude Code, Aider, Codex, etc.) on custom tasks with pass rate, cost, time, and consistency metrics
origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Agent Eval Skill

A lightweight CLI tool for comparing coding agents head-to-head on reproducible tasks. Every "which coding agent is best?" comparison runs on vibes — this tool systematizes it.

## When to Activate

- Comparing coding agents (Claude Code, Aider, Codex, etc.) on your own codebase
- Measuring agent performance before adopting a new tool or model
- Running regression checks when an agent updates its model or tooling
- Producing data-backed agent selection decisions for a team

## Installation

> **Note:** Install agent-eval from its repository after reviewing the source.

## Core Concepts

### YAML Task Definitions

Define tasks declaratively. Each task specifies what to do, which files to touch, and how to judge success:

```yaml
name: add-retry-logic
description: Add exponential backoff retry to the HTTP client
repo: ./my-project
files:
  - src/http_client.py
prompt: |
  Add retry logic with exponential backoff to all HTTP requests.
  Max 3 retries. Initial delay 1s, max delay 30s.
judge:
  - type: pytest
    command: pytest tests/test_http_client.py -v
  - type: grep
    pattern: "exponential_backoff|retry"
    files: src/http_client.py
commit: "abc1234"  # pin to specific commit for reproducibility
```

### Git Worktree Isolation

Each agent run gets its own git worktree — no Docker required. This provides reproducibility isolation so agents cannot interfere with each other or corrupt the base repo.

### Metrics Collected

| Metric | What It Measures |
|--------|-----------------|
| Pass rate | Did the agent produce code that passes the judge? |
| Cost | API spend per task (when available) |
| Time | Wall-clock seconds to completion |
| Consistency | Pass rate across repeated runs (e.g., 3/3 = 100%) |

## Workflow

### 1. Define Tasks

Create a `tasks/` directory with YAML files, one per task:

```bash
mkdir tasks
# Write task definitions (see template above)
```

### 2. Run Agents

Execute agents against your tasks:

```bash
agent-eval run --task tasks/add-retry-logic.yaml --agent claude-code --agent aider --runs 3
```

Each run:
1. Creates a fresh git worktree from the specified commit
2. Hands the prompt to the agent
3. Runs the judge criteria
4. Records pass/fail, cost, and time

### 3. Compare Results

Generate a comparison report:

```bash
agent-eval report --format table
```

```
Task: add-retry-logic (3 runs each)
┌──────────────┬───────────┬────────┬────────┬─────────────┐
│ Agent        │ Pass Rate │ Cost   │ Time   │ Consistency │
├──────────────┼───────────┼────────┼────────┼─────────────┤
│ claude-code  │ 3/3       │ $0.12  │ 45s    │ 100%        │
│ aider        │ 2/3       │ $0.08  │ 38s    │  67%        │
└──────────────┴───────────┴────────┴────────┴─────────────┘
```

## Judge Types

### Code-Based (deterministic)

```yaml
judge:
  - type: pytest
    command: pytest tests/ -v
  - type: command
    command: npm run build
```

### Pattern-Based

```yaml
judge:
  - type: grep
    pattern: "class.*Retry"
    files: src/**/*.py
```

### Model-Based (LLM-as-judge)

```yaml
judge:
  - type: llm
    prompt: |
      Does this implementation correctly handle exponential backoff?
      Check for: max retries, increasing delays, jitter.
```

## Best Practices

- **Start with 3-5 tasks** that represent your real workload, not toy examples
- **Run at least 3 trials** per agent to capture variance — agents are non-deterministic
- **Pin the commit** in your task YAML so results are reproducible across days/weeks
- **Include at least one deterministic judge** (tests, build) per task — LLM judges add noise
- **Track cost alongside pass rate** — a 95% agent at 10x the cost may not be the right choice
- **Version your task definitions** — they are test fixtures, treat them as code

## Links

- Repository: [github.com/joaquinhuigomez/agent-eval](https://github.com/joaquinhuigomez/agent-eval)

---

## 16. verification-loop

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/verification-loop/SKILL.md

---
name: verification-loop
description: "A comprehensive verification system for Claude Code sessions."
origin: ECC
---

# Verification Loop Skill

A comprehensive verification system for Claude Code sessions.

## When to Use

Invoke this skill:
- After completing a feature or significant code change
- Before creating a PR
- When you want to ensure quality gates pass
- After refactoring

## Verification Phases

### Phase 1: Build Verification
```bash
# Check if project builds
npm run build 2>&1 | tail -20
# OR
pnpm build 2>&1 | tail -20
```

If build fails, STOP and fix before continuing.

### Phase 2: Type Check
```bash
# TypeScript projects
npx tsc --noEmit 2>&1 | head -30

# Python projects
pyright . 2>&1 | head -30
```

Report all type errors. Fix critical ones before continuing.

### Phase 3: Lint Check
```bash
# JavaScript/TypeScript
npm run lint 2>&1 | head -30

# Python
ruff check . 2>&1 | head -30
```

### Phase 4: Test Suite
```bash
# Run tests with coverage
npm run test -- --coverage 2>&1 | tail -50

# Check coverage threshold
# Target: 80% minimum
```

Report:
- Total tests: X
- Passed: X
- Failed: X
- Coverage: X%

### Phase 5: Security Scan
```bash
# Check for secrets
grep -rn "sk-" --include="*.ts" --include="*.js" . 2>/dev/null | head -10
grep -rn "api_key" --include="*.ts" --include="*.js" . 2>/dev/null | head -10

# Check for console.log
grep -rn "console.log" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10
```

### Phase 6: Diff Review
```bash
# Show what changed
git diff --stat
git diff HEAD~1 --name-only
```

Review each changed file for:
- Unintended changes
- Missing error handling
- Potential edge cases

## Output Format

After running all phases, produce a verification report:

```
VERIFICATION REPORT
==================

Build:     [PASS/FAIL]
Types:     [PASS/FAIL] (X errors)
Lint:      [PASS/FAIL] (X warnings)
Tests:     [PASS/FAIL] (X/Y passed, Z% coverage)
Security:  [PASS/FAIL] (X issues)
Diff:      [X files changed]

Overall:   [READY/NOT READY] for PR

Issues to Fix:
1. ...
2. ...
```

## Continuous Mode

For long sessions, run verification every 15 minutes or after major changes:

```markdown
Set a mental checkpoint:
- After completing each function
- After finishing a component
- Before moving to next task

Run: /verify
```

## Integration with Hooks

This skill complements PostToolUse hooks but provides deeper verification.
Hooks catch issues immediately; this skill provides comprehensive review.

---

## 17. santa-method

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/santa-method/SKILL.md

---
name: santa-method
description: "Multi-agent adversarial verification with convergence loop. Two independent review agents must both pass before output ships."
origin: "Ronald Skelton - Founder, RapportScore.ai"
---

# Santa Method

Multi-agent adversarial verification framework. Make a list, check it twice. If it's naughty, fix it until it's nice.

The core insight: a single agent reviewing its own output shares the same biases, knowledge gaps, and systematic errors that produced the output. Two independent reviewers with no shared context break this failure mode.

## When to Activate

Invoke this skill when:
- Output will be published, deployed, or consumed by end users
- Compliance, regulatory, or brand constraints must be enforced
- Code ships to production without human review
- Content accuracy matters (technical docs, educational material, customer-facing copy)
- Batch generation at scale where spot-checking misses systemic patterns
- Hallucination risk is elevated (claims, statistics, API references, legal language)

Do NOT use for internal drafts, exploratory research, or tasks with deterministic verification (use build/test/lint pipelines for those).

## Architecture

```
┌─────────────┐
│  GENERATOR   │  Phase 1: Make a List
│  (Agent A)   │  Produce the deliverable
└──────┬───────┘
       │ output
       ▼
┌──────────────────────────────┐
│     DUAL INDEPENDENT REVIEW   │  Phase 2: Check It Twice
│                                │
│  ┌───────────┐ ┌───────────┐  │  Two agents, same rubric,
│  │ Reviewer B │ │ Reviewer C │  │  no shared context
│  └─────┬─────┘ └─────┬─────┘  │
│        │              │        │
└────────┼──────────────┼────────┘
         │              │
         ▼              ▼
┌──────────────────────────────┐
│        VERDICT GATE           │  Phase 3: Naughty or Nice
│                                │
│  B passes AND C passes → NICE  │  Both must pass.
│  Otherwise → NAUGHTY           │  No exceptions.
└──────┬──────────────┬─────────┘
       │              │
    NICE           NAUGHTY
       │              │
       ▼              ▼
   [ SHIP ]    ┌─────────────┐
               │  FIX CYCLE   │  Phase 4: Fix Until Nice
               │              │
               │ iteration++  │  Collect all flags.
               │ if i > MAX:  │  Fix all issues.
               │   escalate   │  Re-run both reviewers.
               │ else:        │  Loop until convergence.
               │   goto Ph.2  │
               └──────────────┘
```

## Phase Details

### Phase 1: Make a List (Generate)

Execute the primary task. No changes to your normal generation workflow. Santa Method is a post-generation verification layer, not a generation strategy.

```python
# The generator runs as normal
output = generate(task_spec)
```

### Phase 2: Check It Twice (Independent Dual Review)

Spawn two review agents in parallel. Critical invariants:

1. **Context isolation** — neither reviewer sees the other's assessment
2. **Identical rubric** — both receive the same evaluation criteria
3. **Same inputs** — both receive the original spec AND the generated output
4. **Structured output** — each returns a typed verdict, not prose

```python
REVIEWER_PROMPT = """
You are an independent quality reviewer. You have NOT seen any other review of this output.

## Task Specification
{task_spec}

## Output Under Review
{output}

## Evaluation Rubric
{rubric}

## Instructions
Evaluate the output against EACH rubric criterion. For each:
- PASS: criterion fully met, no issues
- FAIL: specific issue found (cite the exact problem)

Return your assessment as structured JSON:
{
  "verdict": "PASS" | "FAIL",
  "checks": [
    {"criterion": "...", "result": "PASS|FAIL", "detail": "..."}
  ],
  "critical_issues": ["..."],   // blockers that must be fixed
  "suggestions": ["..."]         // non-blocking improvements
}

Be rigorous. Your job is to find problems, not to approve.
"""
```

```python
# Spawn reviewers in parallel (Claude Code subagents)
review_b = Agent(prompt=REVIEWER_PROMPT.format(...), description="Santa Reviewer B")
review_c = Agent(prompt=REVIEWER_PROMPT.format(...), description="Santa Reviewer C")

# Both run concurrently — neither sees the other
```

### Rubric Design

The rubric is the most important input. Vague rubrics produce vague reviews. Every criterion must have an objective pass/fail condition.

| Criterion | Pass Condition | Failure Signal |
|-----------|---------------|----------------|
| Factual accuracy | All claims verifiable against source material or common knowledge | Invented statistics, wrong version numbers, nonexistent APIs |
| Hallucination-free | No fabricated entities, quotes, URLs, or references | Links to pages that don't exist, attributed quotes with no source |
| Completeness | Every requirement in the spec is addressed | Missing sections, skipped edge cases, incomplete coverage |
| Compliance | Passes all project-specific constraints | Banned terms used, tone violations, regulatory non-compliance |
| Internal consistency | No contradictions within the output | Section A says X, section B says not-X |
| Technical correctness | Code compiles/runs, algorithms are sound | Syntax errors, logic bugs, wrong complexity claims |

#### Domain-Specific Rubric Extensions

**Content/Marketing:**
- Brand voice adherence
- SEO requirements met (keyword density, meta tags, structure)
- No competitor trademark misuse
- CTA present and correctly linked

**Code:**
- Type safety (no `any` leaks, proper null handling)
- Error handling coverage
- Security (no secrets in code, input validation, injection prevention)
- Test coverage for new paths

**Compliance-Sensitive (regulated, legal, financial):**
- No outcome guarantees or unsubstantiated claims
- Required disclaimers present
- Approved terminology only
- Jurisdiction-appropriate language

### Phase 3: Naughty or Nice (Verdict Gate)

```python
def santa_verdict(review_b, review_c):
    """Both reviewers must pass. No partial credit."""
    if review_b.verdict == "PASS" and review_c.verdict == "PASS":
        return "NICE"  # Ship it

    # Merge flags from both reviewers, deduplicate
    all_issues = dedupe(review_b.critical_issues + review_c.critical_issues)
    all_suggestions = dedupe(review_b.suggestions + review_c.suggestions)

    return "NAUGHTY", all_issues, all_suggestions
```

Why both must pass: if only one reviewer catches an issue, that issue is real. The other reviewer's blind spot is exactly the failure mode Santa Method exists to eliminate.

### Phase 4: Fix Until Nice (Convergence Loop)

```python
MAX_ITERATIONS = 3

for iteration in range(MAX_ITERATIONS):
    verdict, issues, suggestions = santa_verdict(review_b, review_c)

    if verdict == "NICE":
        log_santa_result(output, iteration, "passed")
        return ship(output)

    # Fix all critical issues (suggestions are optional)
    output = fix_agent.execute(
        output=output,
        issues=issues,
        instruction="Fix ONLY the flagged issues. Do not refactor or add unrequested changes."
    )

    # Re-run BOTH reviewers on fixed output (fresh agents, no memory of previous round)
    review_b = Agent(prompt=REVIEWER_PROMPT.format(output=output, ...))
    review_c = Agent(prompt=REVIEWER_PROMPT.format(output=output, ...))

# Exhausted iterations — escalate
log_santa_result(output, MAX_ITERATIONS, "escalated")
escalate_to_human(output, issues)
```

Critical: each review round uses **fresh agents**. Reviewers must not carry memory from previous rounds, as prior context creates anchoring bias.

## Implementation Patterns

### Pattern A: Claude Code Subagents (Recommended)

Subagents provide true context isolation. Each reviewer is a separate process with no shared state.

```bash
# In a Claude Code session, use the Agent tool to spawn reviewers
# Both agents run in parallel for speed
```

```python
# Pseudocode for Agent tool invocation
reviewer_b = Agent(
    description="Santa Review B",
    prompt=f"Review this output for quality...\n\nRUBRIC:\n{rubric}\n\nOUTPUT:\n{output}"
)
reviewer_c = Agent(
    description="Santa Review C",
    prompt=f"Review this output for quality...\n\nRUBRIC:\n{rubric}\n\nOUTPUT:\n{output}"
)
```

### Pattern B: Sequential Inline (Fallback)

When subagents aren't available, simulate isolation with explicit context resets:

1. Generate output
2. New context: "You are Reviewer 1. Evaluate ONLY against this rubric. Find problems."
3. Record findings verbatim
4. Clear context completely
5. New context: "You are Reviewer 2. Evaluate ONLY against this rubric. Find problems."
6. Compare both reviews, fix, repeat

The subagent pattern is strictly superior — inline simulation risks context bleed between reviewers.

### Pattern C: Batch Sampling

For large batches (100+ items), full Santa on every item is cost-prohibitive. Use stratified sampling:

1. Run Santa on a random sample (10-15% of batch, minimum 5 items)
2. Categorize failures by type (hallucination, compliance, completeness, etc.)
3. If systematic patterns emerge, apply targeted fixes to the entire batch
4. Re-sample and re-verify the fixed batch
5. Continue until a clean sample passes

```python
import random

def santa_batch(items, rubric, sample_rate=0.15):
    sample = random.sample(items, max(5, int(len(items) * sample_rate)))

    for item in sample:
        result = santa_full(item, rubric)
        if result.verdict == "NAUGHTY":
            pattern = classify_failure(result.issues)
            items = batch_fix(items, pattern)  # Fix all items matching pattern
            return santa_batch(items, rubric)   # Re-sample

    return items  # Clean sample → ship batch
```

## Failure Modes and Mitigations

| Failure Mode | Symptom | Mitigation |
|-------------|---------|------------|
| Infinite loop | Reviewers keep finding new issues after fixes | Max iteration cap (3). Escalate. |
| Rubber stamping | Both reviewers pass everything | Adversarial prompt: "Your job is to find problems, not approve." |
| Subjective drift | Reviewers flag style preferences, not errors | Tight rubric with objective pass/fail criteria only |
| Fix regression | Fixing issue A introduces issue B | Fresh reviewers each round catch regressions |
| Reviewer agreement bias | Both reviewers miss the same thing | Mitigated by independence, not eliminated. For critical output, add a third reviewer or human spot-check. |
| Cost explosion | Too many iterations on large outputs | Batch sampling pattern. Budget caps per verification cycle. |

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| Verification Loop | Use for deterministic checks (build, lint, test). Santa for semantic checks (accuracy, hallucinations). Run verification-loop first, Santa second. |
| Eval Harness | Santa Method results feed eval metrics. Track pass@k across Santa runs to measure generator quality over time. |
| Continuous Learning v2 | Santa findings become instincts. Repeated failures on the same criterion → learned behavior to avoid the pattern. |
| Strategic Compact | Run Santa BEFORE compacting. Don't lose review context mid-verification. |

## Metrics

Track these to measure Santa Method effectiveness:

- **First-pass rate**: % of outputs that pass Santa on round 1 (target: >70%)
- **Mean iterations to convergence**: average rounds to NICE (target: <1.5)
- **Issue taxonomy**: distribution of failure types (hallucination vs. completeness vs. compliance)
- **Reviewer agreement**: % of issues flagged by both reviewers vs. only one (low agreement = rubric needs tightening)
- **Escape rate**: issues found post-ship that Santa should have caught (target: 0)

## Cost Analysis

Santa Method costs approximately 2-3x the token cost of generation alone per verification cycle. For most high-stakes output, this is a bargain:

```
Cost of Santa = (generation tokens) + 2×(review tokens per round) × (avg rounds)
Cost of NOT Santa = (reputation damage) + (correction effort) + (trust erosion)
```

For batch operations, the sampling pattern reduces cost to ~15-20% of full verification while catching >90% of systematic issues.

---

## 18. agent-introspection-debugging

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-introspection-debugging/SKILL.md

---
name: agent-introspection-debugging
description: Structured self-debugging workflow for AI agent failures using capture, diagnosis, contained recovery, and introspection reports.
origin: ECC
---

# Agent Introspection Debugging

Use this skill when an agent run is failing repeatedly, consuming tokens without progress, looping on the same tools, or drifting away from the intended task.

This is a workflow skill, not a hidden runtime. It teaches the agent to debug itself systematically before escalating to a human.

## When to Activate

- Maximum tool call / loop-limit failures
- Repeated retries with no forward progress
- Context growth or prompt drift that starts degrading output quality
- File-system or environment state mismatch between expectation and reality
- Tool failures that are likely recoverable with diagnosis and a smaller corrective action

## Scope Boundaries

Activate this skill for:
- capturing failure state before retrying blindly
- diagnosing common agent-specific failure patterns
- applying contained recovery actions
- producing a structured human-readable debug report

Do not use this skill as the primary source for:
- feature verification after code changes; use `verification-loop`
- framework-specific debugging when a narrower ECC skill already exists
- runtime promises the current harness cannot enforce automatically

## Four-Phase Loop

### Phase 1: Failure Capture

Before trying to recover, record the failure precisely.

Capture:
- error type, message, and stack trace when available
- last meaningful tool call sequence
- what the agent was trying to do
- current context pressure: repeated prompts, oversized pasted logs, duplicated plans, or runaway notes
- current environment assumptions: cwd, branch, relevant service state, expected files

Minimum capture template:

```markdown
## Failure Capture
- Session / task:
- Goal in progress:
- Error:
- Last successful step:
- Last failed tool / command:
- Repeated pattern seen:
- Environment assumptions to verify:
```

### Phase 2: Root-Cause Diagnosis

Match the failure to a known pattern before changing anything.

| Pattern | Likely Cause | Check |
| --- | --- | --- |
| Maximum tool calls / repeated same command | loop or no-exit observer path | inspect the last N tool calls for repetition |
| Context overflow / degraded reasoning | unbounded notes, repeated plans, oversized logs | inspect recent context for duplication and low-signal bulk |
| `ECONNREFUSED` / timeout | service unavailable or wrong port | verify service health, URL, and port assumptions |
| `429` / quota exhaustion | retry storm or missing backoff | count repeated calls and inspect retry spacing |
| file missing after write / stale diff | race, wrong cwd, or branch drift | re-check path, cwd, git status, and actual file existence |
| tests still failing after “fix” | wrong hypothesis | isolate the exact failing test and re-derive the bug |

Diagnosis questions:
- is this a logic failure, state failure, environment failure, or policy failure?
- did the agent lose the real objective and start optimizing the wrong subtask?
- is the failure deterministic or transient?
- what is the smallest reversible action that would validate the diagnosis?

### Phase 3: Contained Recovery

Recover with the smallest action that changes the diagnosis surface.

Safe recovery actions:
- stop repeated retries and restate the hypothesis
- trim low-signal context and keep only the active goal, blockers, and evidence
- re-check the actual filesystem / branch / process state
- narrow the task to one failing command, one file, or one test
- switch from speculative reasoning to direct observation
- escalate to a human when the failure is high-risk or externally blocked

Do not claim unsupported auto-healing actions like “reset agent state” or “update harness config” unless you are actually doing them through real tools in the current environment.

Contained recovery checklist:

```markdown
## Recovery Action
- Diagnosis chosen:
- Smallest action taken:
- Why this is safe:
- What evidence would prove the fix worked:
```

### Phase 4: Introspection Report

End with a report that makes the recovery legible to the next agent or human.

```markdown
## Agent Self-Debug Report
- Session / task:
- Failure:
- Root cause:
- Recovery action:
- Result: success | partial | blocked
- Token / time burn risk:
- Follow-up needed:
- Preventive change to encode later:
```

## Recovery Heuristics

Prefer these interventions in order:

1. Restate the real objective in one sentence.
2. Verify the world state instead of trusting memory.
3. Shrink the failing scope.
4. Run one discriminating check.
5. Only then retry.

Bad pattern:
- retrying the same action three times with slightly different wording

Good pattern:
- capture failure
- classify the pattern
- run one direct check
- change the plan only if the check supports it

## Integration with ECC

- Use `verification-loop` after recovery if code was changed.
- Use `continuous-learning-v2` when the failure pattern is worth turning into an instinct or later skill.
- Use `council` when the issue is not technical failure but decision ambiguity.
- Use `workspace-surface-audit` if the failure came from conflicting local state or repo drift.

## Output Standard

When this skill is active, do not end with “I fixed it” alone.

Always provide:
- the failure pattern
- the root-cause hypothesis
- the recovery action
- the evidence that the situation is now better or still blocked

---

## 19. skill-comply

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/skill-comply/SKILL.md

---
name: skill-comply
description: Visualize whether skills, rules, and agent definitions are actually followed — auto-generates scenarios at 3 prompt strictness levels, runs agents, classifies behavioral sequences, and reports compliance rates with full tool call timelines
origin: ECC
tools: Read, Bash
---

# skill-comply: Automated Compliance Measurement

Measures whether coding agents actually follow skills, rules, or agent definitions by:
1. Auto-generating expected behavioral sequences (specs) from any .md file
2. Auto-generating scenarios with decreasing prompt strictness (supportive → neutral → competing)
3. Running `claude -p` and capturing tool call traces via stream-json
4. Classifying tool calls against spec steps using LLM (not regex)
5. Checking temporal ordering deterministically
6. Generating self-contained reports with spec, prompts, and timelines

## Supported Targets

- **Skills** (`skills/*/SKILL.md`): Workflow skills like search-first, TDD guides
- **Rules** (`rules/common/*.md`): Mandatory rules like testing.md, security.md, git-workflow.md
- **Agent definitions** (`agents/*.md`): Whether an agent gets invoked when expected (internal workflow verification not yet supported)

## When to Activate

- User runs `/skill-comply <path>`
- User asks "is this rule actually being followed?"
- After adding new rules/skills, to verify agent compliance
- Periodically as part of quality maintenance

## Usage

```bash
# Full run
uv run python -m scripts.run ~/.claude/rules/common/testing.md

# Dry run (no cost, spec + scenarios only)
uv run python -m scripts.run --dry-run ~/.claude/skills/search-first/SKILL.md

# Custom models
uv run python -m scripts.run --gen-model haiku --model sonnet <path>
```

## Key Concept: Prompt Independence

Measures whether a skill/rule is followed even when the prompt doesn't explicitly support it.

## Report Contents

Reports are self-contained and include:
1. Expected behavioral sequence (auto-generated spec)
2. Scenario prompts (what was asked at each strictness level)
3. Compliance scores per scenario
4. Tool call timelines with LLM classification labels

### Advanced (optional)

For users familiar with hooks, reports also include hook promotion recommendations for steps with low compliance. This is informational — the main value is the compliance visibility itself.

---

## 20. skill-stocktake

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/skill-stocktake/SKILL.md

---
name: skill-stocktake
description: "Use when auditing Claude skills and commands for quality. Supports Quick Scan (changed skills only) and Full Stocktake modes with sequential subagent batch evaluation."
origin: ECC
---

# skill-stocktake

Slash command (`/skill-stocktake`) that audits all Claude skills and commands using a quality checklist + AI holistic judgment. Supports two modes: Quick Scan for recently changed skills, and Full Stocktake for a complete review.

## Scope

The command targets the following paths **relative to the directory where it is invoked**:

| Path | Description |
|------|-------------|
| `~/.claude/skills/` | Global skills (all projects) |
| `{cwd}/.claude/skills/` | Project-level skills (if the directory exists) |

**At the start of Phase 1, the command explicitly lists which paths were found and scanned.**

### Targeting a specific project

To include project-level skills, run from that project's root directory:

```bash
cd ~/path/to/my-project
/skill-stocktake
```

If the project has no `.claude/skills/` directory, only global skills and commands are evaluated.

## Modes

| Mode | Trigger | Duration |
|------|---------|---------|
| Quick Scan | `results.json` exists (default) | 5–10 min |
| Full Stocktake | `results.json` absent, or `/skill-stocktake full` | 20–30 min |

**Results cache:** `~/.claude/skills/skill-stocktake/results.json`

## Quick Scan Flow

Re-evaluate only skills that have changed since the last run (5–10 min).

1. Read `~/.claude/skills/skill-stocktake/results.json`
2. Run: `bash ~/.claude/skills/skill-stocktake/scripts/quick-diff.sh \
         ~/.claude/skills/skill-stocktake/results.json`
   (Project dir is auto-detected from `$PWD/.claude/skills`; pass it explicitly only if needed)
3. If output is `[]`: report "No changes since last run." and stop
4. Re-evaluate only those changed files using the same Phase 2 criteria
5. Carry forward unchanged skills from previous results
6. Output only the diff
7. Run: `bash ~/.claude/skills/skill-stocktake/scripts/save-results.sh \
         ~/.claude/skills/skill-stocktake/results.json <<< "$EVAL_RESULTS"`

## Full Stocktake Flow

### Phase 1 — Inventory

Run: `bash ~/.claude/skills/skill-stocktake/scripts/scan.sh`

The script enumerates skill files, extracts frontmatter, and collects UTC mtimes.
Project dir is auto-detected from `$PWD/.claude/skills`; pass it explicitly only if needed.
Present the scan summary and inventory table from the script output:

```
Scanning:
  ✓ ~/.claude/skills/         (17 files)
  ✗ {cwd}/.claude/skills/    (not found — global skills only)
```

| Skill | 7d use | 30d use | Description |
|-------|--------|---------|-------------|

### Phase 2 — Quality Evaluation

Launch an Agent tool subagent (**general-purpose agent**) with the full inventory and checklist:

```text
Agent(
  subagent_type="general-purpose",
  prompt="
Evaluate the following skill inventory against the checklist.

[INVENTORY]

[CHECKLIST]

Return JSON for each skill:
{ \"verdict\": \"Keep\"|\"Improve\"|\"Update\"|\"Retire\"|\"Merge into [X]\", \"reason\": \"...\" }
"
)
```

The subagent reads each skill, applies the checklist, and returns per-skill JSON:

`{ "verdict": "Keep"|"Improve"|"Update"|"Retire"|"Merge into [X]", "reason": "..." }`

**Chunk guidance:** Process ~20 skills per subagent invocation to keep context manageable. Save intermediate results to `results.json` (`status: "in_progress"`) after each chunk.

After all skills are evaluated: set `status: "completed"`, proceed to Phase 3.

**Resume detection:** If `status: "in_progress"` is found on startup, resume from the first unevaluated skill.

Each skill is evaluated against this checklist:

```
- [ ] Content overlap with other skills checked
- [ ] Overlap with MEMORY.md / CLAUDE.md checked
- [ ] Freshness of technical references verified (use WebSearch if tool names / CLI flags / APIs are present)
- [ ] Usage frequency considered
```

Verdict criteria:

| Verdict | Meaning |
|---------|---------|
| Keep | Useful and current |
| Improve | Worth keeping, but specific improvements needed |
| Update | Referenced technology is outdated (verify with WebSearch) |
| Retire | Low quality, stale, or cost-asymmetric |
| Merge into [X] | Substantial overlap with another skill; name the merge target |

Evaluation is **holistic AI judgment** — not a numeric rubric. Guiding dimensions:
- **Actionability**: code examples, commands, or steps that let you act immediately
- **Scope fit**: name, trigger, and content are aligned; not too broad or narrow
- **Uniqueness**: value not replaceable by MEMORY.md / CLAUDE.md / another skill
- **Currency**: technical references work in the current environment

**Reason quality requirements** — the `reason` field must be self-contained and decision-enabling:
- Do NOT write "unchanged" alone — always restate the core evidence
- For **Retire**: state (1) what specific defect was found, (2) what covers the same need instead
  - Bad: `"Superseded"`
  - Good: `"disable-model-invocation: true already set; superseded by continuous-learning-v2 which covers all the same patterns plus confidence scoring. No unique content remains."`
- For **Merge**: name the target and describe what content to integrate
  - Bad: `"Overlaps with X"`
  - Good: `"42-line thin content; Step 4 of chatlog-to-article already covers the same workflow. Integrate the 'article angle' tip as a note in that skill."`
- For **Improve**: describe the specific change needed (what section, what action, target size if relevant)
  - Bad: `"Too long"`
  - Good: `"276 lines; Section 'Framework Comparison' (L80–140) duplicates ai-era-architecture-principles; delete it to reach ~150 lines."`
- For **Keep** (mtime-only change in Quick Scan): restate the original verdict rationale, do not write "unchanged"
  - Bad: `"Unchanged"`
  - Good: `"mtime updated but content unchanged. Unique Python reference explicitly imported by rules/python/; no overlap found."`

### Phase 3 — Summary Table

| Skill | 7d use | Verdict | Reason |
|-------|--------|---------|--------|

### Phase 4 — Consolidation

1. **Retire / Merge**: present detailed justification per file before confirming with user:
   - What specific problem was found (overlap, staleness, broken references, etc.)
   - What alternative covers the same functionality (for Retire: which existing skill/rule; for Merge: the target file and what content to integrate)
   - Impact of removal (any dependent skills, MEMORY.md references, or workflows affected)
2. **Improve**: present specific improvement suggestions with rationale:
   - What to change and why (e.g., "trim 430→200 lines because sections X/Y duplicate python-patterns")
   - User decides whether to act
3. **Update**: present updated content with sources checked
4. Check MEMORY.md line count; propose compression if >100 lines

## Results File Schema

`~/.claude/skills/skill-stocktake/results.json`:

**`evaluated_at`**: Must be set to the actual UTC time of evaluation completion.
Obtain via Bash: `date -u +%Y-%m-%dT%H:%M:%SZ`. Never use a date-only approximation like `T00:00:00Z`.

```json
{
  "evaluated_at": "2026-02-21T10:00:00Z",
  "mode": "full",
  "batch_progress": {
    "total": 80,
    "evaluated": 80,
    "status": "completed"
  },
  "skills": {
    "skill-name": {
      "path": "~/.claude/skills/skill-name/SKILL.md",
      "verdict": "Keep",
      "reason": "Concrete, actionable, unique value for X workflow",
      "mtime": "2026-01-15T08:30:00Z"
    }
  }
}
```

## Notes

- Evaluation is blind: the same checklist applies to all skills regardless of origin (ECC, self-authored, auto-extracted)
- Archive / delete operations always require explicit user confirmation
- No verdict branching by skill origin

---

## 21. continuous-learning-v2

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/continuous-learning-v2/SKILL.md

---
name: continuous-learning-v2
description: Instinct-based learning system that observes sessions via hooks, creates atomic instincts with confidence scoring, and evolves them into skills/commands/agents. v2.1 adds project-scoped instincts to prevent cross-project contamination.
origin: ECC
version: 2.1.0
---

# Continuous Learning v2.1 - Instinct
-Based Architecture

An advanced learning system that turns your Claude Code sessions into reusable knowledge through atomic "instincts" - small learned behaviors with confidence scoring.

**v2.1** adds **project-scoped instincts** — React patterns stay in your React project, Python conventions stay in your Python project, and universal patterns (like "always validate input") are shared globally.

## When to Activate

- Setting up automatic learning from Claude Code sessions
- Configuring instinct-based behavior extraction via hooks
- Tuning confidence thresholds for learned behaviors
- Reviewing, exporting, or importing instinct libraries
- Evolving instincts into full skills, commands, or agents
- Managing project-scoped vs global instincts
- Promoting instincts from project to global scope

## What's New in v2.1

| Feature | v2.0 | v2.1 |
|---------|------|------|
| Storage | Global (`~/.claude/homunculus/`) | Project-scoped (`${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/projects/<hash>/`) |
| Scope | All instincts apply everywhere | Project-scoped + global |
| Detection | None | git remote URL / repo path |
| Promotion | N/A | Project → global when seen in 2+ projects |
| Commands | 4 (status/evolve/export/import) | 6 (+promote/projects) |
| Cross-project | Contamination risk | Isolated by default |

## What's New in v2 (vs v1)

| Feature | v1 | v2 |
|---------|----|----|
| Observation | Stop hook (session end) | PreToolUse/PostToolUse (100% reliable) |
| Analysis | Main context | Background agent (Haiku) |
| Granularity | Full skills | Atomic "instincts" |
| Confidence | None | 0.3-0.9 weighted |
| Evolution | Direct to skill | Instincts -> cluster -> skill/command/agent |
| Sharing | None | Export/import instincts |

## The Instinct Model

An instinct is a small learned behavior:

```yaml
---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.7
domain: "code-style"
source: "session-observation"
scope: project
project_id: "a1b2c3d4e5f6"
project_name: "my-react-app"
---

# Prefer Functional Style

## Action
Use functional patterns over classes when appropriate.

## Evidence
- Observed 5 instances of functional pattern preference
- User corrected class-based approach to functional on 2025-01-15
```

**Properties:**
- **Atomic** -- one trigger, one action
- **Confidence-weighted** -- 0.3 = tentative, 0.9 = near certain
- **Domain-tagged** -- code-style, testing, git, debugging, workflow, etc.
- **Evidence-backed** -- tracks what observations created it
- **Scope-aware** -- `project` (default) or `global`

## How It Works

```
Session Activity (in a git repo)
      |
      | Hooks capture prompts + tool use (100% reliable)
      | + detect project context (git remote / repo path)
      v
+---------------------------------------------+
|  projects/<project-hash>/observations.jsonl  |
|   (prompts, tool calls, outcomes, project)   |
+---------------------------------------------+
      |
      | Observer agent reads (background, Haiku)
      v
+---------------------------------------------+
|          PATTERN DETECTION                   |
|   * User corrections -> instinct             |
|   * Error resolutions -> instinct            |
|   * Repeated workflows -> instinct           |
|   * Scope decision: project or global?       |
+---------------------------------------------+
      |
      | Creates/updates
      v
+---------------------------------------------+
|  projects/<project-hash>/instincts/personal/ |
|   * prefer-functional.yaml (0.7) [project]   |
|   * use-react-hooks.yaml (0.9) [project]     |
+---------------------------------------------+
|  instincts/personal/  (GLOBAL)               |
|   * always-validate-input.yaml (0.85) [global]|
|   * grep-before-edit.yaml (0.6) [global]     |
+---------------------------------------------+
      |
      | /evolve clusters + /promote
      v
+---------------------------------------------+
|  projects/<hash>/evolved/ (project-scoped)   |
|  evolved/ (global)                           |
|   * commands/new-feature.md                  |
|   * skills/testing-workflow.md               |
|   * agents/refactor-specialist.md            |
+---------------------------------------------+
```

## Project Detection

The system automatically detects your current project:

1. **`CLAUDE_PROJECT_DIR` env var** (highest priority)
2. **`git remote get-url origin`** -- hashed to create a portable project ID (same repo on different machines gets the same ID)
3. **`git rev-parse --show-toplevel`** -- fallback using repo path (machine-specific)
4. **Global fallback** -- if no project is detected, instincts go to global scope

Each project gets a 12-character hash ID (e.g., `a1b2c3d4e5f6`). A registry file at `${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/projects.json` maps IDs to human-readable names.

### Data Directory

Continuous-learning-v2 stores observer data outside `~/.claude` so Claude Code's sensitive-path guard does not block background instinct writes:

1. `CLV2_HOMUNCULUS_DIR` when set to an absolute path
2. `$XDG_DATA_HOME/ecc-homunculus`
3. `$HOME/.local/share/ecc-homunculus`

Existing users with data at `~/.claude/homunculus` can migrate once:

```bash
bash skills/continuous-learning-v2/scripts/migrate-homunculus.sh
```

## Quick Start

### 1. Enable Observation Hooks

**If installed as a plugin** (recommended):

No extra `settings.json` hook block is required. Claude Code v2.1+ auto-loads the plugin `hooks/hooks.json`, and `observe.sh` is already registered there.

If you previously copied `observe.sh` into `~/.claude/settings.json`, remove that duplicate `PreToolUse` / `PostToolUse` block. Duplicating the plugin hook causes double execution and `${CLAUDE_PLUGIN_ROOT}` resolution errors because that variable is only available inside plugin-managed `hooks/hooks.json` entries.

**If installed manually** to `~/.claude/skills`, add this to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }]
  }
}
```

### 2. Initialize Directory Structure

The system creates directories automatically on first use, but you can also create them manually:

```bash
# Global directories
mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/ecc-homunculus"/{instincts/{personal,inherited},evolved/{agents,skills,commands},projects}

# Project directories are auto-created when the hook first runs in a git repo
```

### 3. Use the Instinct Commands

```bash
/instinct-status     # Show learned instincts (project + global)
/evolve              # Cluster related instincts into skills/commands
/instinct-export     # Export instincts to file
/instinct-import     # Import instincts from others
/promote             # Promote project instincts to global scope
/projects            # List all known projects and their instinct counts
```

## Commands

| Command | Description |
|---------|-------------|
| `/instinct-status` | Show all instincts (project-scoped + global) with confidence |
| `/evolve` | Cluster related instincts into skills/commands, suggest promotions |
| `/instinct-export` | Export instincts (filterable by scope/domain) |
| `/instinct-import <file>` | Import instincts with scope control |
| `/promote [id]` | Promote project instincts to global scope |
| `/projects` | List all known projects and their instinct counts |

## Configuration

Edit `config.json` to control the background observer:

```json
{
  "version": "2.1",
  "observer": {
    "enabled": false,
    "run_interval_minutes": 5,
    "min_observations_to_analyze": 20
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `observer.enabled` | `false` | Enable the background observer agent |
| `observer.run_interval_minutes` | `5` | How often the observer analyzes observations |
| `observer.min_observations_to_analyze` | `20` | Minimum observations before analysis runs |

Other behavior (observation capture, instinct thresholds, project scoping, promotion criteria) is configured via code defaults in `instinct-cli.py` and `observe.sh`.

## File Structure

```
${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/
+-- identity.json           # Your profile, technical level
+-- projects.json           # Registry: project hash -> name/path/remote
+-- observations.jsonl      # Global observations (fallback)
+-- instincts/
|   +-- personal/           # Global auto-learned instincts
|   +-- inherited/          # Global imported instincts
+-- evolved/
|   +-- agents/             # Global generated agents
|   +-- skills/             # Global generated skills
|   +-- commands/           # Global generated commands
+-- projects/
    +-- a1b2c3d4e5f6/       # Project hash (from git remote URL)
    |   +-- project.json    # Per-project metadata mirror (id/name/root/remote)
    |   +-- observations.jsonl
    |   +-- observations.archive/
    |   +-- instincts/
    |   |   +-- personal/   # Project-specific auto-learned
    |   |   +-- inherited/  # Project-specific imported
    |   +-- evolved/
    |       +-- skills/
    |       +-- commands/
    |       +-- agents/
    +-- f6e5d4c3b2a1/       # Another project
        +-- ...
```

## Scope Decision Guide

| Pattern Type | Scope | Examples |
|-------------|-------|---------|
| Language/framework conventions | **project** | "Use React hooks", "Follow Django REST patterns" |
| File structure preferences | **project** | "Tests in `__tests__`/", "Components in src/components/" |
| Code style | **project** | "Use functional style", "Prefer dataclasses" |
| Error handling strategies | **project** | "Use Result type for errors" |
| Security practices | **global** | "Validate user input", "Sanitize SQL" |
| General best practices | **global** | "Write tests first", "Always handle errors" |
| Tool workflow preferences | **global** | "Grep before Edit", "Read before Write" |
| Git practices | **global** | "Conventional commits", "Small focused commits" |

## Instinct Promotion (Project -> Global)

When the same instinct appears in multiple projects with high confidence, it's a candidate for promotion to global scope.

**Auto-promotion criteria:**
- Same instinct ID in 2+ projects
- Average confidence >= 0.8

**How to promote:**

```bash
# Promote a specific instinct
python3 instinct-cli.py promote prefer-explicit-errors

# Auto-promote all qualifying instincts
python3 instinct-cli.py promote

# Preview without changes
python3 instinct-cli.py promote --dry-run
```

The `/evolve` command also suggests promotion candidates.

## Confidence Scoring

Confidence evolves over time:

| Score | Meaning | Behavior |
|-------|---------|----------|
| 0.3 | Tentative | Suggested but not enforced |
| 0.5 | Moderate | Applied when relevant |
| 0.7 | Strong | Auto-approved for application |
| 0.9 | Near-certain | Core behavior |

**Confidence increases** when:
- Pattern is repeatedly observed
- User doesn't correct the suggested behavior
- Similar instincts from other sources agree

**Confidence decreases** when:
- User explicitly corrects the behavior
- Pattern isn't observed for extended periods
- Contradicting evidence appears

## Why Hooks vs Skills for Observation?

> "v1 relied on skills to observe. Skills are probabilistic -- they fire ~50-80% of the time based on Claude's judgment."

Hooks fire **100% of the time**, deterministically. This means:
- Every tool call is observed
- No patterns are missed
- Learning is comprehensive

## Backward Compatibility

v2.1 is fully compatible with v2.0 and v1:
- Existing global instincts can be migrated from `~/.claude/homunculus/instincts/` with `scripts/migrate-homunculus.sh`
- Existing `~/.claude/skills/learned/` skills from v1 still work
- Stop hook still runs (but now also feeds into v2)
- Gradual migration: run both in parallel

## Privacy

- Observations stay **local** on your machine
- Project-scoped instincts are isolated per project
- Only **instincts** (patterns) can be exported — not raw observations
- No actual code or conversation content is shared
- You control what gets exported and promoted

## Related

- [ECC-Tools GitHub App](https://github.com/apps/ecc-tools) - Generate instincts from repo history
- Homunculus - Community project that inspired the v2 instinct-based architecture (atomic observations, confidence scoring, instinct evolution pipeline)
- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - Continuous learning section

---

*Instinct-based learning: teaching Claude your patterns, one project at a time.*

---

## 22. ck

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/ck/SKILL.md

---
name: ck
description: Persistent per-project memory for Claude Code. Auto-loads project context on session start, tracks sessions with git activity, and writes to native memory. Commands run deterministic Node.js scripts — behavior is consistent across model versions.
origin: community
version: 2.0.0
author: sreedhargs89
repo: https://github.com/sreedhargs89/context-keeper
---

# ck — Context Keeper

You are the **Context Keeper** assistant. When the user invokes any `/ck:*` command,
run the corresponding Node.js script and present its stdout to the user verbatim.
Scripts live at: `~/.claude/skills/ck/commands/` (expand `~` with `$HOME`).

---

## Data Layout

```
~/.claude/ck/
├── projects.json              ← path → {name, contextDir, lastUpdated}
└── contexts/<name>/
    ├── context.json           ← SOURCE OF TRUTH (structured JSON, v2)
    └── CONTEXT.md             ← generated view — do not hand-edit
```

---

## Commands

### `/ck:init` — Register a Project
```bash
node "$HOME/.claude/skills/ck/commands/init.mjs"
```
The script outputs JSON with auto-detected info. Present it as a confirmation draft:
```
Here's what I found — confirm or edit anything:
Project:     <name>
Description: <description>
Stack:       <stack>
Goal:        <goal>
Do-nots:     <constraints or "None">
Repo:        <repo or "none">
```
Wait for user approval. Apply any edits. Then pipe confirmed JSON to save.mjs --init:
```bash
echo '<confirmed-json>' | node "$HOME/.claude/skills/ck/commands/save.mjs" --init
```
Confirmed JSON schema: `{"name":"...","path":"...","description":"...","stack":["..."],"goal":"...","constraints":["..."],"repo":"..." }`

---

### `/ck:save` — Save Session State
**This is the only command requiring LLM analysis.** Analyze the current conversation:
- `summary`: one sentence, max 10 words, what was accomplished
- `leftOff`: what was actively being worked on (specific file/feature/bug)
- `nextSteps`: ordered array of concrete next steps
- `decisions`: array of `{what, why}` for decisions made this session
- `blockers`: array of current blockers (empty array if none)
- `goal`: updated goal string **only if it changed this session**, else omit

Show a draft summary to the user: `"Session: '<summary>' — save this? (yes / edit)"`
Wait for confirmation. Then pipe to save.mjs:
```bash
echo '<json>' | node "$HOME/.claude/skills/ck/commands/save.mjs"
```
JSON schema (exact): `{"summary":"...","leftOff":"...","nextSteps":["..."],"decisions":[{"what":"...","why":"..."}],"blockers":["..."]}`
Display the script's stdout confirmation verbatim.

---

### `/ck:resume [name|number]` — Full Briefing
```bash
node "$HOME/.claude/skills/ck/commands/resume.mjs" [arg]
```
Display output verbatim. Then ask: "Continue from here? Or has anything changed?"
If user reports changes → run `/ck:save` immediately.

---

### `/ck:info [name|number]` — Quick Snapshot
```bash
node "$HOME/.claude/skills/ck/commands/info.mjs" [arg]
```
Display output verbatim. No follow-up question.

---

### `/ck:list` — Portfolio View
```bash
node "$HOME/.claude/skills/ck/commands/list.mjs"
```
Display output verbatim. If user replies with a number or name → run `/ck:resume`.

---

### `/ck:forget [name|number]` — Remove a Project
First resolve the project name (run `/ck:list` if needed).
Ask: `"This will permanently delete context for '<name>'. Are you sure? (yes/no)"`
If yes:
```bash
node "$HOME/.claude/skills/ck/commands/forget.mjs" [name]
```
Display confirmation verbatim.

---

### `/ck:migrate` — Convert v1 Data to v2
```bash
node "$HOME/.claude/skills/ck/commands/migrate.mjs"
```
For a dry run first:
```bash
node "$HOME/.claude/skills/ck/commands/migrate.mjs" --dry-run
```
Display output verbatim. Migrates all v1 CONTEXT.md + meta.json files to v2 context.json.
Originals are backed up as `meta.json.v1-backup` — nothing is deleted.

---

## SessionStart Hook

The hook at `~/.claude/skills/ck/hooks/session-start.mjs` must be registered in
`~/.claude/settings.json` to auto-load project context on session start:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"~/.claude/skills/ck/hooks/session-start.mjs\"" }] }
    ]
  }
}
```

The hook injects ~100 tokens per session (compact 5-line summary). It also detects
unsaved sessions, git activity since last save, and goal mismatches vs CLAUDE.md.

---

## Rules
- Always expand `~` as `$HOME` in Bash calls.
- Commands are case-insensitive: `/CK:SAVE`, `/ck:save`, `/Ck:Save` all work.
- If a script exits with code 1, display its stdout as an error message.
- Never edit `context.json` or `CONTEXT.md` directly — always use the scripts.
- If `projects.json` is malformed, tell the user and offer to reset it to `{}`.

---

## 23. context-budget

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/context-budget/SKILL.md

---
name: context-budget
description: Audits Claude Code context window consumption across agents, skills, MCP servers, and rules. Identifies bloat, redundant components, and produces prioritized token-savings recommendations.
origin: ECC
---

# Context Budget

Analyze token overhead across every loaded component in a Claude Code session and surface actionable optimizations to reclaim context space.

## When to Use

- Session performance feels sluggish or output quality is degrading
- You've recently added many skills, agents, or MCP servers
- You want to know how much context headroom you actually have
- Planning to add more components and need to know if there's room
- Running `/context-budget` command (this skill backs it)

## How It Works

### Phase 1: Inventory

Scan all component directories and estimate token consumption:

**Agents** (`agents/*.md`)
- Count lines and tokens per file (words × 1.3)
- Extract `description` frontmatter length
- Flag: files >200 lines (heavy), description >30 words (bloated frontmatter)

**Skills** (`skills/*/SKILL.md`)
- Count tokens per SKILL.md
- Flag: files >400 lines
- Check for duplicate copies in `.agents/skills/` — skip identical copies to avoid double-counting

**Rules** (`rules/**/*.md`)
- Count tokens per file
- Flag: files >100 lines
- Detect content overlap between rule files in the same language module

**MCP Servers** (`.mcp.json` or active MCP config)
- Count configured servers and total tool count
- Estimate schema overhead at ~500 tokens per tool
- Flag: servers with >20 tools, servers that wrap simple CLI commands (`gh`, `git`, `npm`, `supabase`, `vercel`)

**CLAUDE.md** (project + user-level)
- Count tokens per file in the CLAUDE.md chain
- Flag: combined total >300 lines

### Phase 2: Classify

Sort every component into a bucket:

| Bucket | Criteria | Action |
|--------|----------|--------|
| **Always needed** | Referenced in CLAUDE.md, backs an active command, or matches current project type | Keep |
| **Sometimes needed** | Domain-specific (e.g. language patterns), not referenced in CLAUDE.md | Consider on-demand activation |
| **Rarely needed** | No command reference, overlapping content, or no obvious project match | Remove or lazy-load |

### Phase 3: Detect Issues

Identify the following problem patterns:

- **Bloated agent descriptions** — description >30 words in frontmatter loads into every Task tool invocation
- **Heavy agents** — files >200 lines inflate Task tool context on every spawn
- **Redundant components** — skills that duplicate agent logic, rules that duplicate CLAUDE.md
- **MCP over-subscription** — >10 servers, or servers wrapping CLI tools available for free
- **CLAUDE.md bloat** — verbose explanations, outdated sections, instructions that should be rules

### Phase 4: Report

Produce the context budget report:

```
Context Budget Report
═══════════════════════════════════════

Total estimated overhead: ~XX,XXX tokens
Context model: Claude Sonnet (200K window)
Effective available context: ~XXX,XXX tokens (XX%)

Component Breakdown:
┌─────────────────┬────────┬───────────┐
│ Component       │ Count  │ Tokens    │
├─────────────────┼────────┼───────────┤
│ Agents          │ N      │ ~X,XXX    │
│ Skills          │ N      │ ~X,XXX    │
│ Rules           │ N      │ ~X,XXX    │
│ MCP tools       │ N      │ ~XX,XXX   │
│ CLAUDE.md       │ N      │ ~X,XXX    │
└─────────────────┴────────┴───────────┘

WARNING: Issues Found (N):
[ranked by token savings]

Top 3 Optimizations:
1. [action] → save ~X,XXX tokens
2. [action] → save ~X,XXX tokens
3. [action] → save ~X,XXX tokens

Potential savings: ~XX,XXX tokens (XX% of current overhead)
```

In verbose mode, additionally output per-file token counts, line-by-line breakdown of the heaviest files, specific redundant lines between overlapping components, and MCP tool list with per-tool schema size estimates.

## Examples

**Basic audit**
```
User: /context-budget
Skill: Scans setup → 16 agents (12,400 tokens), 28 skills (6,200), 87 MCP tools (43,500), 2 CLAUDE.md (1,200)
       Flags: 3 heavy agents, 14 MCP servers (3 CLI-replaceable)
       Top saving: remove 3 MCP servers → -27,500 tokens (47% overhead reduction)
```

**Verbose mode**
```
User: /context-budget --verbose
Skill: Full report + per-file breakdown showing planner.md (213 lines, 1,840 tokens),
       MCP tool list with per-tool sizes, duplicated rule lines side by side
```

**Pre-expansion check**
```
User: I want to add 5 more MCP servers, do I have room?
Skill: Current overhead 33% → adding 5 servers (~50 tools) would add ~25,000 tokens → pushes to 45% overhead
       Recommendation: remove 2 CLI-replaceable servers first to stay under 40%
```

## Best Practices

- **Token estimation**: use `words × 1.3` for prose, `chars / 4` for code-heavy files
- **MCP is the biggest lever**: each tool schema costs ~500 tokens; a 30-tool server costs more than all your skills combined
- **Agent descriptions are loaded always**: even if the agent is never invoked, its description field is present in every Task tool context
- **Verbose mode for debugging**: use when you need to pinpoint the exact files driving overhead, not for regular audits
- **Audit after changes**: run after adding any agent, skill, or MCP server to catch creep early

---

## 24. strategic-compact

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/strategic-compact/SKILL.md

---
name: strategic-compact
description: Suggests manual context compaction at logical intervals to preserve context through task phases rather than arbitrary auto-compaction.
origin: ECC
---

# Strategic Compact Skill

Suggests manual `/compact` at strategic points in your workflow rather than relying on arbitrary auto-compaction.

## When to Activate

- Running long sessions that approach context limits (200K+ tokens)
- Working on multi-phase tasks (research → plan → implement → test)
- Switching between unrelated tasks within the same session
- After completing a major milestone and starting new work
- When responses slow down or become less coherent (context pressure)

## Why Strategic Compaction?

Auto-compaction triggers at arbitrary points:
- Often mid-task, losing important context
- No awareness of logical task boundaries
- Can interrupt complex multi-step operations

Strategic compaction at logical boundaries:
- **After exploration, before execution** — Compact research context, keep implementation plan
- **After completing a milestone** — Fresh start for next phase
- **Before major context shifts** — Clear exploration context before different task

## How It Works

The `suggest-compact.js` script runs on PreToolUse (Edit/Write) and:

1. **Tracks tool calls** — Counts tool invocations in session
2. **Threshold detection** — Suggests at configurable threshold (default: 50 calls)
3. **Periodic reminders** — Reminds every 25 calls after threshold

## Hook Setup

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit",
        "hooks": [{ "type": "command", "command": "node ~/.claude/scripts/hooks/suggest-compact.js" }]
      },
      {
        "matcher": "Write",
        "hooks": [{ "type": "command", "command": "node ~/.claude/scripts/hooks/suggest-compact.js" }]
      }
    ]
  }
}
```

## Configuration

Environment variables:
- `COMPACT_THRESHOLD` — Tool calls before first suggestion (default: 50)

## Compaction Decision Guide

Use this table to decide when to compact:

| Phase Transition | Compact? | Why |
|-----------------|----------|-----|
| Research → Planning | Yes | Research context is bulky; plan is the distilled output |
| Planning → Implementation | Yes | Plan is in TodoWrite or a file; free up context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code; compact if switching focus |
| Debugging → Next feature | Yes | Debug traces pollute context for unrelated work |
| Mid-implementation | No | Losing variable names, file paths, and partial state is costly |
| After a failed approach | Yes | Clear the dead-end reasoning before trying a new approach |

## What Survives Compaction

Understanding what persists helps you compact with confidence:

| Persists | Lost |
|----------|------|
| CLAUDE.md instructions | Intermediate reasoning and analysis |
| TodoWrite task list | File contents you previously read |
| Memory files (`~/.claude/memory/`) | Multi-step conversation context |
| Git state (commits, branches) | Tool call history and counts |
| Files on disk | Nuanced user preferences stated verbally |

## Best Practices

1. **Compact after planning** — Once plan is finalized in TodoWrite, compact to start fresh
2. **Compact after debugging** — Clear error-resolution context before continuing
3. **Don't compact mid-implementation** — Preserve context for related changes
4. **Read the suggestion** — The hook tells you *when*, you decide *if*
5. **Write before compacting** — Save important context to files or memory before compacting
6. **Use `/compact` with a summary** — Add a custom message: `/compact Focus on implementing auth middleware next`

## Token Optimization Patterns

### Trigger-Table Lazy Loading
Instead of loading full skill content at session start, use a trigger table that maps keywords to skill paths. Skills load only when triggered, reducing baseline context by 50%+:

| Trigger | Skill | Load When |
|---------|-------|-----------|
| "test", "tdd", "coverage" | tdd-workflow | User mentions testing |
| "security", "auth", "xss" | security-review | Security-related work |
| "deploy", "ci/cd" | deployment-patterns | Deployment context |

### Context Composition Awareness
Monitor what's consuming your context window:
- **CLAUDE.md files** — Always loaded, keep lean
- **Loaded skills** — Each skill adds 1-5K tokens
- **Conversation history** — Grows with each exchange
- **Tool results** — File reads, search results add bulk

### Duplicate Instruction Detection
Common sources of duplicate context:
- Same rules in both `~/.claude/rules/` and project `.claude/rules/`
- Skills that repeat CLAUDE.md instructions
- Multiple skills covering overlapping domains

### Context Optimization Tools
- `token-optimizer` MCP — Automated 95%+ token reduction via content deduplication
- `context-mode` — Context virtualization (315KB to 5.4KB demonstrated)

## Related

- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) — Token optimization section
- Memory persistence hooks — For state that survives compaction
- `continuous-learning` skill — Extracts patterns before session ends

---

## 25. token-budget-advisor

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/token-budget-advisor/SKILL.md

---
name: token-budget-advisor
description: >-
  Offers the user an informed choice about how much response depth to
  consume before answering. Use this skill when the user explicitly
  wants to control response length, depth, or token budget.
  TRIGGER when: "token budget", "token count", "token usage", "token limit",
  "response length", "answer depth", "short version", "brief answer",
  "detailed answer", "exhaustive answer", "respuesta corta vs larga",
  "cuántos tokens", "ahorrar tokens", "responde al 50%", "dame la versión
  corta", "quiero controlar cuánto usas", or clear variants where the
  user is explicitly asking to control answer size or depth.
  DO NOT TRIGGER when: user has already specified a level in the current
  session (maintain it), the request is clearly a one-word answer, or
  "token" refers to auth/session/payment tokens rather than response size.
origin: community
---

# Token Budget Advisor (TBA)

Intercept the response flow to offer the user a choice about response depth **before** Claude answers.

## When to Use

- User wants to control how long or detailed a response is
- User mentions tokens, budget, depth, or response length
- User says "short version", "tldr", "brief", "al 25%", "exhaustive", etc.
- Any time the user wants to choose depth/detail level upfront

**Do not trigger** when: user already set a level this session (maintain it silently), or the answer is trivially one line.

## How It Works

### Step 1 — Estimate input tokens

Use the repository's canonical context-budget heuristics to estimate the prompt's token count mentally.

Use the same calibration guidance as [context-budget](../context-budget/SKILL.md):

- prose: `words × 1.3`
- code-heavy or mixed/code blocks: `chars / 4`

For mixed content, use the dominant content type and keep the estimate heuristic.

### Step 2 — Estimate response size by complexity

Classify the prompt, then apply the multiplier range to get the full response window:

| Complexity   | Multiplier range | Example prompts                                      |
|--------------|------------------|------------------------------------------------------|
| Simple       | 3× – 8×          | "What is X?", yes/no, single fact                   |
| Medium       | 8× – 20×         | "How does X work?"                                  |
| Medium-High  | 10× – 25×        | Code request with context                           |
| Complex      | 15× – 40×        | Multi-part analysis, comparisons, architecture      |
| Creative     | 10× – 30×        | Stories, essays, narrative writing                  |

Response window = `input_tokens × mult_min` to `input_tokens × mult_max` (but don’t exceed your model’s configured output-token limit).

### Step 3 — Present depth options

Present this block **before** answering, using the actual estimated numbers:

```
Analyzing your prompt...

Input: ~[N] tokens  |  Type: [type]  |  Complexity: [level]  |  Language: [lang]

Choose your depth level:

[1] Essential   (25%)  ->  ~[tokens]   Direct answer only, no preamble
[2] Moderate    (50%)  ->  ~[tokens]   Answer + context + 1 example
[3] Detailed    (75%)  ->  ~[tokens]   Full answer with alternatives
[4] Exhaustive (100%)  ->  ~[tokens]   Everything, no limits

Which level? (1-4 or say "25% depth", "50% depth", "75% depth", "100% depth")

Precision: heuristic estimate ~85-90% accuracy (±15%).
```

Level token estimates (within the response window):
- 25%  → `min + (max - min) × 0.25`
- 50%  → `min + (max - min) × 0.50`
- 75%  → `min + (max - min) × 0.75`
- 100% → `max`

### Step 4 — Respond at the chosen level

| Level            | Target length       | Include                                             | Omit                                              |
|------------------|---------------------|-----------------------------------------------------|---------------------------------------------------|
| 25% Essential    | 2-4 sentences max   | Direct answer, key conclusion                       | Context, examples, nuance, alternatives           |
| 50% Moderate     | 1-3 paragraphs      | Answer + necessary context + 1 example              | Deep analysis, edge cases, references             |
| 75% Detailed     | Structured response | Multiple examples, pros/cons, alternatives          | Extreme edge cases, exhaustive references         |
| 100% Exhaustive  | No restriction      | Everything — full analysis, all code, all perspectives | Nothing                                        |

## Shortcuts — skip the question

If the user already signals a level, respond at that level immediately without asking:

| What they say                                      | Level |
|----------------------------------------------------|-------|
| "1" / "25% depth" / "short version" / "brief answer" / "tldr"  | 25%   |
| "2" / "50% depth" / "moderate depth" / "balanced answer"        | 50%   |
| "3" / "75% depth" / "detailed answer" / "thorough answer"       | 75%   |
| "4" / "100% depth" / "exhaustive answer" / "full deep dive"     | 100%  |

If the user set a level earlier in the session, **maintain it silently** for subsequent responses unless they change it.

## Precision note

This skill uses heuristic estimation — no real tokenizer. Accuracy ~85-90%, variance ±15%. Always show the disclaimer.

## Examples

### Triggers

- "Give me the short version first."
- "How many tokens will your answer use?"
- "Respond at 50% depth."
- "I want the exhaustive answer, not the summary."
- "Dame la version corta y luego la detallada."

### Does Not Trigger

- "What is a JWT token?"
- "The checkout flow uses a payment token."
- "Is this normal?"
- "Complete the refactor."
- Follow-up questions after the user already chose a depth for the session

## Source

Standalone skill from [TBA — Token Budget Advisor for Claude Code](https://github.com/Xabilimon1/Token-Budget-Advisor-Claude-Code-).
Original project also ships a Python estimator script, but this repository keeps the skill self-contained and heuristic-only.

---

## 26. safety-guard

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/safety-guard/SKILL.md

---
name: safety-guard
description: Use this skill to prevent destructive operations when working on production systems or running agents autonomously.
origin: ECC
---

# Safety Guard — Prevent Destructive Operations

## When to Use

- When working on production systems
- When agents are running autonomously (full-auto mode)
- When you want to restrict edits to a specific directory
- During sensitive operations (migrations, deploys, data changes)

## How It Works

Three modes of protection:

### Mode 1: Careful Mode

Intercepts destructive commands before execution and warns:

```
Watched patterns:
- rm -rf (especially /, ~, or project root)
- git push --force
- git reset --hard
- git checkout . (discard all changes)
- DROP TABLE / DROP DATABASE
- docker system prune
- kubectl delete
- chmod 777
- sudo rm
- npm publish (accidental publishes)
- Any command with --no-verify
```

When detected: shows what the command does, asks for confirmation, suggests safer alternative.

### Mode 2: Freeze Mode

Locks file edits to a specific directory tree:

```
/safety-guard freeze src/components/
```

Any Write/Edit outside `src/components/` is blocked with an explanation. Useful when you want an agent to focus on one area without touching unrelated code.

### Mode 3: Guard Mode (Careful + Freeze combined)

Both protections active. Maximum safety for autonomous agents.

```
/safety-guard guard --dir src/api/ --allow-read-all
```

Agents can read anything but only write to `src/api/`. Destructive commands are blocked everywhere.

### Unlock

```
/safety-guard off
```

## Implementation

Uses PreToolUse hooks to intercept Bash, Write, Edit, and MultiEdit tool calls. Checks the command/path against the active rules before allowing execution.

## Integration

- Enable by default for `codex -a never` sessions
- Pair with observability risk scoring in ECC 2.0
- Logs all blocked actions to `~/.claude/safety-guard.log`

---

## 27. workspace-surface-audit

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/workspace-surface-audit/SKILL.md

---
name: workspace-surface-audit
description: Audit the active repo, MCP servers, plugins, connectors, env surfaces, and harness setup, then recommend the highest-value ECC-native skills, hooks, agents, and operator workflows. Use when the user wants help setting up Claude Code or understanding what capabilities are actually available in their environment.
origin: ECC
---

# Workspace Surface Audit

Read-only audit skill for answering the question "what can this workspace and machine actually do right now, and what should we add or enable next?"

This is the ECC-native answer to setup-audit plugins. It does not modify files unless the user explicitly asks for follow-up implementation.

## When to Use

- User says "set up Claude Code", "recommend automations", "what plugins or MCPs should I use?", or "what am I missing?"
- Auditing a machine or repo before installing more skills, hooks, or connectors
- Comparing official marketplace plugins against ECC-native coverage
- Reviewing `.env`, `.mcp.json`, plugin settings, or connected-app surfaces to find missing workflow layers
- Deciding whether a capability should be a skill, hook, agent, MCP, or external connector

## Non-Negotiable Rules

- Never print secret values. Surface only provider names, capability names, file paths, and whether a key or config exists.
- Prefer ECC-native workflows over generic "install another plugin" advice when ECC can reasonably own the surface.
- Treat external plugins as benchmarks and inspiration, not authoritative product boundaries.
- Separate three things clearly:
  - already available now
  - available but not wrapped well in ECC
  - not available and would require a new integration

## Audit Inputs

Inspect only the files and settings needed to answer the question well:

1. Repo surface
   - `package.json`, lockfiles, language markers, framework config, `README.md`
   - `.mcp.json`, `.lsp.json`, `.claude/settings*.json`, `.codex/*`
   - `AGENTS.md`, `CLAUDE.md`, install manifests, hook configs
2. Environment surface
   - `.env*` files in the active repo and obvious adjacent ECC workspaces
   - Surface only key names such as `STRIPE_API_KEY`, `TWILIO_AUTH_TOKEN`, `FAL_KEY`
3. Connected tool surface
   - Installed plugins, enabled connectors, MCP servers, LSPs, and app integrations
4. ECC surface
   - Existing skills, commands, hooks, agents, and install modules that already cover the need

## Audit Process

### Phase 1: Inventory What Exists

Produce a compact inventory:

- active harness targets
- installed plugins and connected apps
- configured MCP servers
- configured LSP servers
- env-backed services implied by key names
- existing ECC skills already relevant to the workspace

If a surface exists only as a primitive, call that out. Example:

- "Stripe is available via connected app, but ECC lacks a billing-operator skill"
- "Google Drive is connected, but there is no ECC-native Google Workspace operator workflow"

### Phase 2: Benchmark Against Official and Installed Surfaces

Compare the workspace against:

- official Claude plugins that overlap with setup, review, docs, design, or workflow quality
- locally installed plugins in Claude or Codex
- the user's currently connected app surfaces

Do not just list names. For each comparison, answer:

1. what they actually do
2. whether ECC already has parity
3. whether ECC only has primitives
4. whether ECC is missing the workflow entirely

### Phase 3: Turn Gaps Into ECC Decisions

For every real gap, recommend the correct ECC-native shape:

| Gap Type | Preferred ECC Shape |
|----------|---------------------|
| Repeatable operator workflow | Skill |
| Automatic enforcement or side-effect | Hook |
| Specialized delegated role | Agent |
| External tool bridge | MCP server or connector |
| Install/bootstrap guidance | Setup or audit skill |

Default to user-facing skills that orchestrate existing tools when the need is operational rather than infrastructural.

## Output Format

Return five sections in this order:

1. **Current surface**
   - what is already usable right now
2. **Parity**
   - where ECC already matches or exceeds the benchmark
3. **Primitive-only gaps**
   - tools exist, but ECC lacks a clean operator skill
4. **Missing integrations**
   - capability not available yet
5. **Top 3-5 next moves**
   - concrete ECC-native additions, ordered by impact

## Recommendation Rules

- Recommend at most 1-2 highest-value ideas per category.
- Favor skills with obvious user intent and business value:
  - setup audit
  - billing/customer ops
  - issue/program ops
  - Google Workspace ops
  - deployment/ops control
- If a connector is company-specific, recommend it only when it is genuinely available or clearly useful to the user's workflow.
- If ECC already has a strong primitive, propose a wrapper skill instead of inventing a brand-new subsystem.

## Good Outcomes

- The user can immediately see what is connected, what is missing, and what ECC should own next.
- Recommendations are specific enough to implement in the repo without another discovery pass.
- The final answer is organized around workflows, not API brands.

---

## 28. automation-audit-ops

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/automation-audit-ops/SKILL.md

---
name: automation-audit-ops
description: Evidence-first automation inventory and overlap audit workflow for ECC. Use when the user wants to know which jobs, hooks, connectors, MCP servers, or wrappers are live, broken, redundant, or missing before fixing anything.
origin: ECC
---

# Automation Audit Ops

Use this when the user asks what automations are live, which jobs are broken, where overlap exists, or what tooling and connectors are actually doing useful work right now.

This is an audit-first operator skill. The job is to produce an evidence-backed inventory and a keep / merge / cut / fix-next recommendation set before rewriting anything.

## Skill Stack

Pull these ECC-native skills into the workflow when relevant:

- `workspace-surface-audit` for connector, MCP, hook, and app inventory
- `knowledge-ops` when the audit needs to reconcile live repo truth with durable context
- `github-ops` when the answer depends on CI, scheduled workflows, issues, or PR automation
- `ecc-tools-cost-audit` when the real problem is webhook fanout, queued jobs, or billing burn in the sibling app repo
- `research-ops` when local inventory must be compared against current platform support or public docs
- `verification-loop` for proving post-fix state instead of relying on assumed recovery

## When to Use

- user asks "what automations do I have", "what is live", "what is broken", or "what overlaps"
- the task spans cron jobs, GitHub Actions, local hooks, MCP servers, connectors, wrappers, or app integrations
- the user wants to know what was ported from another agent system and what still needs to be rebuilt inside ECC
- the workspace has accumulated multiple ways to do the same thing and the user wants one canonical lane

## Guardrails

- start read-only unless the user explicitly asked for fixes
- separate:
  - configured
  - authenticated
  - recently verified
  - stale or broken
  - missing entirely
- do not claim a tool is live just because a skill or config references it
- do not merge or delete overlapping surfaces until the evidence table exists

## Workflow

### 1. Inventory the real surface

Read the current live surface before theorizing:

- repo hooks and local hook scripts
- GitHub Actions and scheduled workflows
- MCP configs and enabled servers
- connector- or app-backed integrations
- wrapper scripts and repo-specific automation entrypoints

Group them by surface:

- local runtime
- repo CI / automation
- connected external systems
- messaging / notifications
- billing / customer operations
- research / monitoring

### 2. Classify each item by live state

For every surfaced automation, mark:

- configured
- authenticated
- recently verified
- stale or broken
- missing

Then classify the problem type:

- active breakage
- auth outage
- stale status
- overlap or redundancy
- missing capability

### 3. Trace the proof path

Back every important claim with a concrete source:

- file path
- workflow run
- hook log
- config entry
- recent command output
- exact failure signature

If the current state is ambiguous, say so directly instead of pretending the audit is complete.

### 4. End with keep / merge / cut / fix-next

For each overlapping or suspect surface, return one call:

- keep
- merge
- cut
- fix next

The value is in collapsing noisy automation into one canonical ECC lane, not in preserving every historical path.

## Output Format

```text
CURRENT SURFACE
- automation
- source
- live state
- proof

FINDINGS
- active breakage
- overlap
- stale status
- missing capability

RECOMMENDATION
- keep
- merge
- cut
- fix next

NEXT ECC MOVE
- exact skill / hook / workflow / app lane to strengthen
```

## Pitfalls

- do not answer from memory when the live inventory can be read
- do not treat "present in config" as "working"
- do not fix lower-value redundancy before naming the broken high-signal path
- do not widen the task into a repo rewrite if the user asked for inventory first

## Verification

- important claims cite a live proof path
- each surfaced automation is labeled with a clear live-state category
- the final recommendation distinguishes keep / merge / cut / fix-next

---

## 29. agent-sort

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/agent-sort/SKILL.md

---
name: agent-sort
description: Build an evidence-backed ECC install plan for a specific repo by sorting skills, commands, rules, hooks, and extras into DAILY vs LIBRARY buckets using parallel repo-aware review passes. Use when ECC should be trimmed to what a project actually needs instead of loading the full bundle.
origin: ECC
---

# Agent Sort

Use this skill when a repo needs a project-specific ECC surface instead of the default full install.

The goal is not to guess what "feels useful." The goal is to classify ECC components with evidence from the actual codebase.

## When to Use

- A project only needs a subset of ECC and full installs are too noisy
- The repo stack is clear, but nobody wants to hand-curate skills one by one
- A team wants a repeatable install decision backed by grep evidence instead of opinion
- You need to separate always-loaded daily workflow surfaces from searchable library/reference surfaces
- A repo has drifted into the wrong language, rule, or hook set and needs cleanup

## Non-Negotiable Rules

- Use the current repository as the source of truth, not generic preferences
- Every DAILY decision must cite concrete repo evidence
- LIBRARY does not mean "delete"; it means "keep accessible without loading by default"
- Do not install hooks, rules, or scripts that the current repo cannot use
- Prefer ECC-native surfaces; do not introduce a second install system

## Outputs

Produce these artifacts in order:

1. DAILY inventory
2. LIBRARY inventory
3. install plan
4. verification report
5. optional `skill-library` router if the project wants one

## Classification Model

Use two buckets only:

- `DAILY`
  - should load every session for this repo
  - strongly matched to the repo's language, framework, workflow, or operator surface
- `LIBRARY`
  - useful to retain, but not worth loading by default
  - should remain reachable through search, router skill, or selective manual use

## Evidence Sources

Use repo-local evidence before making any classification:

- file extensions
- package managers and lockfiles
- framework configs
- CI and hook configs
- build/test scripts
- imports and dependency manifests
- repo docs that explicitly describe the stack

Useful commands include:

```bash
rg --files
rg -n "typescript|react|next|supabase|django|spring|flutter|swift"
cat package.json
cat pyproject.toml
cat Cargo.toml
cat pubspec.yaml
cat go.mod
```

## Parallel Review Passes

If parallel subagents are available, split the review into these passes:

1. Agents
   - classify `agents/*`
2. Skills
   - classify `skills/*`
3. Commands
   - classify `commands/*`
4. Rules
   - classify `rules/*`
5. Hooks and scripts
   - classify hook surfaces, MCP health checks, helper scripts, and OS compatibility
6. Extras
   - classify contexts, examples, MCP configs, templates, and guidance docs

If subagents are not available, run the same passes sequentially.

## Core Workflow

### 1. Read the repo

Establish the real stack before classifying anything:

- languages in use
- frameworks in use
- primary package manager
- test stack
- lint/format stack
- deployment/runtime surface
- operator integrations already present

### 2. Build the evidence table

For every candidate surface, record:

- component path
- component type
- proposed bucket
- repo evidence
- short justification

Use this format:

```text
skills/frontend-patterns | skill | DAILY | 84 .tsx files, next.config.ts present | core frontend stack
skills/django-patterns   | skill | LIBRARY | no .py files, no pyproject.toml       | not active in this repo
rules/typescript/*       | rules | DAILY | package.json + tsconfig.json            | active TS repo
rules/python/*           | rules | LIBRARY | zero Python source files             | keep accessible only
```

### 3. Decide DAILY vs LIBRARY

Promote to `DAILY` when:

- the repo clearly uses the matching stack
- the component is general enough to help every session
- the repo already depends on the corresponding runtime or workflow

Demote to `LIBRARY` when:

- the component is off-stack
- the repo might need it later, but not every day
- it adds context overhead without immediate relevance

### 4. Build the install plan

Translate the classification into action:

- DAILY skills -> install or keep in `.claude/skills/`
- DAILY commands -> keep as explicit shims only if still useful
- DAILY rules -> install only matching language sets
- DAILY hooks/scripts -> keep only compatible ones
- LIBRARY surfaces -> keep accessible through search or `skill-library`

If the repo already uses selective installs, update that plan instead of creating another system.

### 5. Create the optional library router

If the project wants a searchable library surface, create:

- `.claude/skills/skill-library/SKILL.md`

That router should contain:

- a short explanation of DAILY vs LIBRARY
- grouped trigger keywords
- where the library references live

Do not duplicate every skill body inside the router.

### 6. Verify the result

After the plan is applied, verify:

- every DAILY file exists where expected
- stale language rules were not left active
- incompatible hooks were not installed
- the resulting install actually matches the repo stack

Return a compact report with:

- DAILY count
- LIBRARY count
- removed stale surfaces
- open questions

## Handoffs

If the next step is interactive installation or repair, hand off to:

- `configure-ecc`

If the next step is overlap cleanup or catalog review, hand off to:

- `skill-stocktake`

If the next step is broader context trimming, hand off to:

- `strategic-compact`

## Output Format

Return the result in this order:

```text
STACK
- language/framework/runtime summary

DAILY
- always-loaded items with evidence

LIBRARY
- searchable/reference items with evidence

INSTALL PLAN
- what should be installed, removed, or routed

VERIFICATION
- checks run and remaining gaps
```

---

## 30. architecture-decision-records

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/architecture-decision-records/SKILL.md

---
name: architecture-decision-records
description: Capture architectural decisions made during Claude Code sessions as structured ADRs. Auto-detects decision moments, records context, alternatives considered, and rationale. Maintains an ADR log so future developers understand why the codebase is shaped the way it is.
origin: ECC
---

# Architecture Decision Records

Capture architectural decisions as they happen during coding sessions. Instead of decisions living only in Slack threads, PR comments, or someone's memory, this skill produces structured ADR documents that live alongside the code.

## When to Activate

- User explicitly says "let's record this decision" or "ADR this"
- User chooses between significant alternatives (framework, library, pattern, database, API design)
- User says "we decided to..." or "the reason we're doing X instead of Y is..."
- User asks "why did we choose X?" (read existing ADRs)
- During planning phases when architectural trade-offs are discussed

## ADR Format

Use the lightweight ADR format proposed by Michael Nygard, adapted for AI-assisted development:

```markdown
# ADR-NNNN: [Decision Title]

**Date**: YYYY-MM-DD
**Status**: proposed | accepted | deprecated | superseded by ADR-NNNN
**Deciders**: [who was involved]

## Context

What is the issue that we're seeing that is motivating this decision or change?

[2-5 sentences describing the situation, constraints, and forces at play]

## Decision

What is the change that we're proposing and/or doing?

[1-3 sentences stating the decision clearly]

## Alternatives Considered

### Alternative 1: [Name]
- **Pros**: [benefits]
- **Cons**: [drawbacks]
- **Why not**: [specific reason this was rejected]

### Alternative 2: [Name]
- **Pros**: [benefits]
- **Cons**: [drawbacks]
- **Why not**: [specific reason this was rejected]

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive
- [benefit 1]
- [benefit 2]

### Negative
- [trade-off 1]
- [trade-off 2]

### Risks
- [risk and mitigation]
```

## Workflow

### Capturing a New ADR

When a decision moment is detected:

1. **Initialize (first time only)** — if `docs/adr/` does not exist, ask the user for confirmation before creating the directory, a `README.md` seeded with the index table header (see ADR Index Format below), and a blank `template.md` for manual use. Do not create files without explicit consent.
2. **Identify the decision** — extract the core architectural choice being made
3. **Gather context** — what problem prompted this? What constraints exist?
4. **Document alternatives** — what other options were considered? Why were they rejected?
5. **State consequences** — what are the trade-offs? What becomes easier/harder?
6. **Assign a number** — scan existing ADRs in `docs/adr/` and increment
7. **Confirm and write** — present the draft ADR to the user for review. Only write to `docs/adr/NNNN-decision-title.md` after explicit approval. If the user declines, discard the draft without writing any files.
8. **Update the index** — append to `docs/adr/README.md`

### Reading Existing ADRs

When a user asks "why did we choose X?":

1. Check if `docs/adr/` exists — if not, respond: "No ADRs found in this project. Would you like to start recording architectural decisions?"
2. If it exists, scan `docs/adr/README.md` index for relevant entries
3. Read matching ADR files and present the Context and Decision sections
4. If no match is found, respond: "No ADR found for that decision. Would you like to record one now?"

### ADR Directory Structure

```
docs/
└── adr/
    ├── README.md              ← index of all ADRs
    ├── 0001-use-nextjs.md
    ├── 0002-postgres-over-mongo.md
    ├── 0003-rest-over-graphql.md
    └── template.md            ← blank template for manual use
```

### ADR Index Format

```markdown
# Architecture Decision Records

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-use-nextjs.md) | Use Next.js as frontend framework | accepted | 2026-01-15 |
| [0002](0002-postgres-over-mongo.md) | PostgreSQL over MongoDB for primary datastore | accepted | 2026-01-20 |
| [0003](0003-rest-over-graphql.md) | REST API over GraphQL | accepted | 2026-02-01 |
```

## Decision Detection Signals

Watch for these patterns in conversation that indicate an architectural decision:

**Explicit signals**
- "Let's go with X"
- "We should use X instead of Y"
- "The trade-off is worth it because..."
- "Record this as an ADR"

**Implicit signals** (suggest recording an ADR — do not auto-create without user confirmation)
- Comparing two frameworks or libraries and reaching a conclusion
- Making a database schema design choice with stated rationale
- Choosing between architectural patterns (monolith vs microservices, REST vs GraphQL)
- Deciding on authentication/authorization strategy
- Selecting deployment infrastructure after evaluating alternatives

## What Makes a Good ADR

### Do
- **Be specific** — "Use Prisma ORM" not "use an ORM"
- **Record the why** — the rationale matters more than the what
- **Include rejected alternatives** — future developers need to know what was considered
- **State consequences honestly** — every decision has trade-offs
- **Keep it short** — an ADR should be readable in 2 minutes
- **Use present tense** — "We use X" not "We will use X"

### Don't
- Record trivial decisions — variable naming or formatting choices don't need ADRs
- Write essays — if the context section exceeds 10 lines, it's too long
- Omit alternatives — "we just picked it" is not a valid rationale
- Backfill without marking it — if recording a past decision, note the original date
- Let ADRs go stale — superseded decisions should reference their replacement

## ADR Lifecycle

```
proposed → accepted → [deprecated | superseded by ADR-NNNN]
```

- **proposed**: decision is under discussion, not yet committed
- **accepted**: decision is in effect and being followed
- **deprecated**: decision is no longer relevant (e.g., feature removed)
- **superseded**: a newer ADR replaces this one (always link the replacement)

## Categories of Decisions Worth Recording

| Category | Examples |
|----------|---------|
| **Technology choices** | Framework, language, database, cloud provider |
| **Architecture patterns** | Monolith vs microservices, event-driven, CQRS |
| **API design** | REST vs GraphQL, versioning strategy, auth mechanism |
| **Data modeling** | Schema design, normalization decisions, caching strategy |
| **Infrastructure** | Deployment model, CI/CD pipeline, monitoring stack |
| **Security** | Auth strategy, encryption approach, secret management |
| **Testing** | Test framework, coverage targets, E2E vs integration balance |
| **Process** | Branching strategy, review process, release cadence |

## Integration with Other Skills

- **Planner agent**: when the planner proposes architecture changes, suggest creating an ADR
- **Code reviewer agent**: flag PRs that introduce architectural changes without a corresponding ADR

---

## 31. prompt-optimizer

Source: C:/Users/90514/.claude/plugins/marketplaces/ecc/skills/prompt-optimizer/SKILL.md

---
name: prompt-optimizer
description: >-
  Analyze raw prompts, identify intent and gaps, match ECC components
  (skills/commands/agents/hooks), and output a ready-to-paste optimized
  prompt. Advisory role only — never executes the task itself.
  TRIGGER when: user says "optimize prompt", "improve my prompt",
  "how to write a prompt for", "help me prompt", "rewrite this prompt",
  or explicitly asks to enhance prompt quality. Also triggers on Chinese
  equivalents: "优化prompt", "改进prompt", "怎么写prompt", "帮我优化这个指令".
  DO NOT TRIGGER when: user wants the task executed directly, or says
  "just do it" / "直接做". DO NOT TRIGGER when user says "优化代码",
  "优化性能", "optimize performance", "optimize this code" — those are
  refactoring/performance tasks, not prompt optimization.
origin: community
metadata:
  author: YannJY02
  version: "1.0.0"
---

# Prompt Optimizer

Analyze a draft prompt, critique it, match it to ECC ecosystem components,
and output a complete optimized prompt the user can paste and run.

## When to Use

- User says "optimize this prompt", "improve my prompt", "rewrite this prompt"
- User says "help me write a better prompt for..."
- User says "what's the best way to ask Claude Code to..."
- User says "优化prompt", "改进prompt", "怎么写prompt", "帮我优化这个指令"
- User pastes a draft prompt and asks for feedback or enhancement
- User says "I don't know how to prompt for this"
- User says "how should I use ECC for..."
- User explicitly invokes `/prompt-optimize`

### Do Not Use When

- User wants the task done directly (just execute it)
- User says "优化代码", "优化性能", "optimize this code", "optimize performance" — these are refactoring tasks, not prompt optimization
- User is asking about ECC configuration (use `configure-ecc` instead)
- User wants a skill inventory (use `skill-stocktake` instead)
- User says "just do it" or "直接做"

## How It Works

**Advisory only — do not execute the user's task.**

Do NOT write code, create files, run commands, or take any implementation
action. Your ONLY output is an analysis plus an optimized prompt.

If the user says "just do it", "直接做", or "don't optimize, just execute",
do not switch into implementation mode inside this skill. Tell the user this
skill only produces optimized prompts, and instruct them to make a normal
task request if they want execution instead.

Run this 6-phase pipeline sequentially. Present results using the Output Format below.

### Analysis Pipeline

### Phase 0: Project Detection

Before analyzing the prompt, detect the current project context:

1. Check if a `CLAUDE.md` exists in the working directory — read it for project conventions
2. Detect tech stack from project files:
   - `package.json` → Node.js / TypeScript / React / Next.js
   - `go.mod` → Go
   - `pyproject.toml` / `requirements.txt` → Python
   - `Cargo.toml` → Rust
   - `build.gradle` / `pom.xml` → Java / Kotlin (then check for `quarkus` in build file → Quarkus, or `spring-boot` → Spring Boot)
   - `Package.swift` → Swift
   - `Gemfile` → Ruby
   - `composer.json` → PHP
   - `*.csproj` / `*.sln` → .NET
   - `Makefile` / `CMakeLists.txt` → C / C++
   - `cpanfile` / `Makefile.PL` → Perl
3. Note detected tech stack for use in Phase 3 and Phase 4

If no project files are found (e.g., the prompt is abstract or for a new project),
skip detection and flag "tech stack unknown" in Phase 4.

### Phase 1: Intent Detection

Classify the user's task into one or more categories:

| Category | Signal Words | Example |
|----------|-------------|---------|
| New Feature | build, create, add, implement, 创建, 实现, 添加 | "Build a login page" |
| Bug Fix | fix, broken, not working, error, 修复, 报错 | "Fix the auth flow" |
| Refactor | refactor, clean up, restructure, 重构, 整理 | "Refactor the API layer" |
| Research | how to, what is, explore, investigate, 怎么, 如何 | "How to add SSO" |
| Testing | test, coverage, verify, 测试, 覆盖率 | "Add tests for the cart" |
| Review | review, audit, check, 审查, 检查 | "Review my PR" |
| Documentation | document, update docs, 文档 | "Update the API docs" |
| Infrastructure | deploy, CI, docker, database, 部署, 数据库 | "Set up CI/CD pipeline" |
| Design | design, architecture, plan, 设计, 架构 | "Design the data model" |

### Phase 2: Scope Assessment

If Phase 0 detected a project, use codebase size as a signal. Otherwise, estimate
from the prompt description alone and mark the estimate as uncertain.

| Scope | Heuristic | Orchestration |
|-------|-----------|---------------|
| TRIVIAL | Single file, < 50 lines | Direct execution |
| LOW | Single component or module | Single command or skill |
| MEDIUM | Multiple components, same domain | Command chain + /verify |
| HIGH | Cross-domain, 5+ files | /plan first, then phased execution |
| EPIC | Multi-session, multi-PR, architectural shift | Use blueprint skill for multi-session plan |

### Phase 3: ECC Component Matching

Map intent + scope + tech stack (from Phase 0) to specific ECC components.

#### By Intent Type

| Intent | Commands | Skills | Agents |
|--------|----------|--------|--------|
| New Feature | /plan, /tdd, /code-review, /verify | tdd-workflow, verification-loop | planner, tdd-guide, code-reviewer |
| Bug Fix | /tdd, /build-fix, /verify | tdd-workflow | tdd-guide, build-error-resolver |
| Refactor | /refactor-clean, /code-review, /verify | verification-loop | refactor-cleaner, code-reviewer |
| Research | /plan | search-first, iterative-retrieval | — |
| Testing | /tdd, /e2e, /test-coverage | tdd-workflow, e2e-testing | tdd-guide, e2e-runner |
| Review | /code-review | security-review | code-reviewer, security-reviewer |
| Documentation | /update-docs, /update-codemaps | — | doc-updater |
| Infrastructure | /plan, /verify | docker-patterns, deployment-patterns, database-migrations | architect |
| Design (MEDIUM-HIGH) | /plan | — | planner, architect |
| Design (EPIC) | — | blueprint (invoke as skill) | planner, architect |

#### By Tech Stack

| Tech Stack | Skills to Add | Agent |
|------------|--------------|-------|
| Python / Django | django-patterns, django-tdd, django-security, django-verification, python-patterns, python-testing | python-reviewer |
| Go | golang-patterns, golang-testing | go-reviewer, go-build-resolver |
| Spring Boot / Java | springboot-patterns, springboot-tdd, springboot-security, springboot-verification, java-coding-standards, jpa-patterns | java-reviewer |
| Quarkus / Java | quarkus-patterns, quarkus-tdd, quarkus-security, quarkus-verification, java-coding-standards, jpa-patterns | java-reviewer |
| Kotlin / Android | kotlin-coroutines-flows, compose-multiplatform-patterns, android-clean-architecture | kotlin-reviewer |
| TypeScript / React | frontend-patterns, backend-patterns, coding-standards | code-reviewer |
| Swift / iOS | swiftui-patterns, swift-concurrency-6-2, swift-actor-persistence, swift-protocol-di-testing | code-reviewer |
| PostgreSQL | postgres-patterns, database-migrations | database-reviewer |
| Perl | perl-patterns, perl-testing, perl-security | code-reviewer |
| C++ | cpp-coding-standards, cpp-testing | code-reviewer |
| Other / Unlisted | coding-standards (universal) | code-reviewer |

### Phase 4: Missing Context Detection

Scan the prompt for missing critical information. Check each item and mark
whether Phase 0 auto-detected it or the user must supply it:

- [ ] **Tech stack** — Detected in Phase 0, or must user specify?
- [ ] **Target scope** — Files, directories, or modules mentioned?
- [ ] **Acceptance criteria** — How to know the task is done?
- [ ] **Error handling** — Edge cases and failure modes addressed?
- [ ] **Security requirements** — Auth, input validation, secrets?
- [ ] **Testing expectations** — Unit, integration, E2E?
- [ ] **Performance constraints** — Load, latency, resource limits?
- [ ] **UI/UX requirements** — Design specs, responsive, a11y? (if frontend)
- [ ] **Database changes** — Schema, migrations, indexes? (if data layer)
- [ ] **Existing patterns** — Reference files or conventions to follow?
- [ ] **Scope boundaries** — What NOT to do?

**If 3+ critical items are missing**, ask the user up to 3 clarification
questions before generating the optimized prompt. Then incorporate the
answers into the optimized prompt.

### Phase 5: Workflow & Model Recommendation

Determine where this prompt sits in the development lifecycle:

```
Research → Plan → Implement (TDD) → Review → Verify → Commit
```

For MEDIUM+ tasks, always start with /plan. For EPIC tasks, use blueprint skill.

**Model recommendation** (include in output):

| Scope | Recommended Model | Rationale |
|-------|------------------|-----------|
| TRIVIAL-LOW | Sonnet 4.6 | Fast, cost-efficient for simple tasks |
| MEDIUM | Sonnet 4.6 | Best coding model for standard work |
| HIGH | Sonnet 4.6 (main) + Opus 4.6 (planning) | Opus for architecture, Sonnet for implementation |
| EPIC | Opus 4.6 (blueprint) + Sonnet 4.6 (execution) | Deep reasoning for multi-session planning |

**Multi-prompt splitting** (for HIGH/EPIC scope):

For tasks that exceed a single session, split into sequential prompts:
- Prompt 1: Research + Plan (use search-first skill, then /plan)
- Prompt 2-N: Implement one phase per prompt (each ends with /verify)
- Final Prompt: Integration test + /code-review across all phases
- Use /save-session and /resume-session to preserve context between sessions

---

## Output Format

Present your analysis in this exact structure. Respond in the same language
as the user's input.

### Section 1: Prompt Diagnosis

**Strengths:** List what the original prompt does well.

**Issues:**

| Issue | Impact | Suggested Fix |
|-------|--------|---------------|
| (problem) | (consequence) | (how to fix) |

**Needs Clarification:** Numbered list of questions the user should answer.
If Phase 0 auto-detected the answer, state it instead of asking.

### Section 2: Recommended ECC Components

| Type | Component | Purpose |
|------|-----------|---------|
| Command | /plan | Plan architecture before coding |
| Skill | tdd-workflow | TDD methodology guidance |
| Agent | code-reviewer | Post-implementation review |
| Model | Sonnet 4.6 | Recommended for this scope |

### Section 3: Optimized Prompt — Full Version

Present the complete optimized prompt inside a single fenced code block.
The prompt must be self-contained and ready to copy-paste. Include:
- Clear task description with context
- Tech stack (detected or specified)
- /command invocations at the right workflow stages
- Acceptance criteria
- Verification steps
- Scope boundaries (what NOT to do)

For items that reference blueprint, write: "Use the blueprint skill to..."
(not `/blueprint`, since blueprint is a skill, not a command).

### Section 4: Optimized Prompt — Quick Version

A compact version for experienced ECC users. Vary by intent type:

| Intent | Quick Pattern |
|--------|--------------|
| New Feature | `/plan [feature]. /tdd to implement. /code-review. /verify.` |
| Bug Fix | `/tdd — write failing test for [bug]. Fix to green. /verify.` |
| Refactor | `/refactor-clean [scope]. /code-review. /verify.` |
| Research | `Use search-first skill for [topic]. /plan based on findings.` |
| Testing | `/tdd [module]. /e2e for critical flows. /test-coverage.` |
| Review | `/code-review. Then use security-reviewer agent.` |
| Docs | `/update-docs. /update-codemaps.` |
| EPIC | `Use blueprint skill for "[objective]". Execute phases with /verify gates.` |

### Section 5: Enhancement Rationale

| Enhancement | Reason |
|-------------|--------|
| (what was added) | (why it matters) |

### Footer

> Not what you need? Tell me what to adjust, or make a normal task request
> if you want execution instead of prompt optimization.

---

## Examples

### Trigger Examples

- "Optimize this prompt for ECC"
- "Rewrite this prompt so Claude Code uses the right commands"
- "帮我优化这个指令"
- "How should I prompt ECC for this task?"

### Example 1: Vague Chinese Prompt (Project Detected)

**User input:**
```
帮我写一个用户登录页面
```

**Phase 0 detects:** `package.json` with Next.js 15, TypeScript, Tailwind CSS

**Optimized Prompt (Full):**
```
使用项目现有技术栈（Next.js 15 + TypeScript + Tailwind CSS）实现用户登录页面。

技术要求：
- 沿用项目现有的组件结构和路由约定
- 表单验证使用项目中已有的验证方案（检查是否已用 Zod/Yup/其他）
- 认证方式：沿用项目现有认证方案（如无，默认 JWT）
- 包含：邮箱/密码登录表单、表单验证、错误提示、加载状态、响应式布局

工作流：
1. /plan 先规划组件结构和认证流程，参考现有页面的模式
2. /tdd 测试先行：编写登录表单的单元测试和认证流程的集成测试
3. 实现登录页面和认证逻辑
4. /code-review 审查实现
5. /verify 验证所有测试通过且页面正常渲染

安全要求：
- 密码不明文传输
- 防止暴力破解（rate limiting）
- XSS 防护
- CSRF token

验收标准：
- 所有测试通过，覆盖率 80%+
- 页面在移动端和桌面端正常渲染
- 登录成功跳转到 dashboard，失败显示错误信息

不要做：
- 不要实现注册页面
- 不要实现忘记密码功能
- 不要修改现有的路由结构
```

### Example 2: Moderate English Prompt

**User input:**
```
Add a REST API endpoint for user profile updates with validation
```

**Phase 0 detects:** `go.mod` with Go 1.22, Chi router

**Optimized Prompt (Full):**
```
Add a REST API endpoint for user profile updates (PATCH /api/users/:id).

Tech stack: Go 1.22 + Chi router (detected from project)

Requirements:
- PATCH /api/users/:id — partial update of user profile
- Input validation for fields: name, email, avatar_url, bio
- Auth: require valid token, users can only update own profile
- Return 200 with updated user on success
- Return 400 with validation errors on invalid input
- Return 401/403 for auth failures
- Follow existing API patterns in the codebase

Workflow:
1. /plan the endpoint structure, middleware chain, and validation logic
2. /tdd — write table-driven tests for success, validation failure, auth failure, not-found
3. Implement following existing handler patterns
4. /go-review
5. /verify — run full test suite, confirm no regressions

Do not:
- Modify existing endpoints
- Change the database schema (use existing user table)
- Add new dependencies without checking existing ones first (use search-first skill)
```

### Example 3: EPIC Project

**User input:**
```
Migrate our monolith to microservices
```

**Optimized Prompt (Full):**
```
Use the blueprint skill to plan: "Migrate monolith to microservices architecture"

Before executing, answer these questions in the blueprint:
1. Which domain boundaries exist in the current monolith?
2. Which service should be extracted first (lowest coupling)?
3. Communication pattern: REST APIs, gRPC, or event-driven (Kafka/RabbitMQ)?
4. Database strategy: shared DB initially or database-per-service from start?
5. Deployment target: Kubernetes, Docker Compose, or serverless?

The blueprint should produce phases like:
- Phase 1: Identify service boundaries and create domain map
- Phase 2: Set up infrastructure (API gateway, service mesh, CI/CD per service)
- Phase 3: Extract first service (strangler fig pattern)
- Phase 4: Verify with integration tests, then extract next service
- Phase N: Decommission monolith

Each phase = 1 PR, with /verify gates between phases.
Use /save-session between phases. Use /resume-session to continue.
Use git worktrees for parallel service extraction when dependencies allow.

Recommended: Opus 4.6 for blueprint planning, Sonnet 4.6 for phase execution.
```

---

## Related Components

| Component | When to Reference |
|-----------|------------------|
| `configure-ecc` | User hasn't set up ECC yet |
| `skill-stocktake` | Audit which components are installed (use instead of hardcoded catalog) |
| `search-first` | Research phase in optimized prompts |
| `blueprint` | EPIC-scope optimized prompts (invoke as skill, not command) |
| `strategic-compact` | Long session context management |
| `cost-aware-llm-pipeline` | Token optimization recommendations |

---
