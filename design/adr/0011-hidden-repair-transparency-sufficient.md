# ADR-0011: Hidden Repair Loop Transparency is Sufficient

**Status**: Accepted | **Date**: 2026-05-23

## Context

12-layer audit flagged Layer 11 (Hidden Repair Loops) as "weak protection".

## Industry Comparison

| Framework | Retry Events | Message Diff Logging |
|-----------|-------------|---------------------|
| Pi-mono | auto_retry_start/end + isRetrying | Partial |
| OpenCode | SessionEvent.Retried + status | N/A |
| CrewAI | None (hidden inside invoke loop) | None |
| AgentScope | None | N/A |
| Mastra | None | N/A |
| **AgentForge** | **compat:retry + compat:diff + compatRetries count** | **Yes (diff events)** |

AgentForge is the only framework emitting both retry events AND message diffs.

## Decision

AgentForge hidden repair transparency is sufficient, not a gap. The remaining improvement is documentation.

## Consequences

- No code changes needed
- Document compatRetries in AgentRunResult
- If user feedback demands more, add repairLog field to AgentRunResult