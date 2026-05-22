# ADR-0005: No Time-Based History Pruning

**Status**: Accepted | **Date**: 2026-05-23

## Context

12-layer audit flagged Layer 2 (Session History) as lacking time-based freshness scoring.

## Industry Comparison

All frameworks use token budgets or message counts, never wall-clock age. Mastra (lastMessages count), AgentScope (token threshold), Pi-mono (entry type priority), OpenCode (PRUNE_MINIMUM token budget).

## Decision

Time-based history pruning will not be implemented. Relevance is determined by content, not wall-clock age.

## Consequences

- History pruning remains token-budget-based
- Long-running sessions retain old-but-relevant messages correctly
- If stale context is reported, tune token budgets, not time