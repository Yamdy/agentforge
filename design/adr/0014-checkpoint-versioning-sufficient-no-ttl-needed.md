# ADR-0014: Checkpoint Versioning Sufficient, No TTL Needed

**Status**: Accepted | **Date**: 2026-05-23

## Context

12-layer audit flagged Layer 12 (Persistence) as lacking checkpoint TTL and format migration.

## Industry Comparison

No framework implements checkpoint TTL. For version migration: AgentForge (SERIALIZATION_VERSION=1 + migrate_v1_to_v2 hook) is ahead of Mastra (no versioning), AgentScope (compat fallback only), and ClaudeCode (config-only migration, no transcript validation). Only Pi-mono (CURRENT_SESSION_VERSION=3, sequential migrations) is more complete.

## Decision

Checkpoint TTL will not be implemented. Version migration infrastructure is sufficient — migrate_v1_to_v2 remains as placeholder until a real format change occurs.

## Consequences

- Old checkpoints always resume (session TTL handles cleanup)
- migrate_v1_to_v2 must be implemented when serialization format changes