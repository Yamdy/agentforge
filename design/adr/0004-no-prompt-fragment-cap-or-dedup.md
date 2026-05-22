# ADR-0004: No Prompt Fragment Cap or Deduplication

**Status**: Accepted | **Date**: 2026-05-23

## Context

12-layer audit flagged Layer 1 (System Prompt) as lacking fragment cap and deduplication.

## Industry Comparison

No framework in 11 surveyed reference codebases caps prompt fragments or deduplicates system prompt instructions. AgentScope has token-budget truncation that protects system messages but does not limit fragments.

## Decision

No fragment cap or deduplication will be implemented. The industry treats prompt management as developer responsibility. A hard cap (max 10 fragments) may be added if runtime bloat is observed in production.

## Consequences

- Developers manage their own prompt fragments
- Semantic conflict detection is not feasible at framework level