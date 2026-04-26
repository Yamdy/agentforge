/**
 * AgentForge Audit Module
 *
 * Append-only audit log with SHA-256 hash chain integrity.
 *
 * @module
 */

// Implementation
export { SqliteAuditStore } from './sqlite-audit-store.js';

// Hash chain utilities
export { sha256, computeEntryHash, verifyChain } from './hash-chain.js';
