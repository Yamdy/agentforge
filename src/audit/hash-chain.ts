/**
 * SHA-256 Hash Chain for Audit Log Integrity
 *
 * Provides cryptographic chaining for append-only audit entries.
 * Each entry's hash is computed from its content + previous entry's hash,
 * forming an immutable chain similar to blockchain.
 *
 * @module
 */

import { createHash } from 'node:crypto';

/**
 * Compute SHA-256 hash of a string
 */
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute the hash for an audit entry.
 *
 * Hash = SHA-256(previousHash + timestamp + sessionId + eventType + action + resource + result + JSON(details))
 *
 * @param fields - Entry fields to hash (excluding id and hash itself)
 * @param previousHash - Hash of the previous entry (empty string for genesis)
 * @returns SHA-256 hex digest
 */
export function computeEntryHash(
  fields: {
    timestamp: string;
    sessionId: string;
    agentName: string;
    eventType: string;
    action: string;
    resource: string;
    result: string;
    details: Record<string, unknown>;
  },
  previousHash: string
): string {
  const payload = [
    previousHash,
    fields.timestamp,
    fields.sessionId,
    fields.agentName,
    fields.eventType,
    fields.action,
    fields.resource,
    fields.result,
    JSON.stringify(fields.details),
  ].join('|');

  return sha256(payload);
}

/**
 * Verify that a hash chain is intact.
 *
 * Checks:
 * 1. Each entry's computed hash matches its stored hash
 * 2. Each entry's previousHash matches the previous entry's hash
 *
 * @param entries - Ordered list of audit entries (oldest first)
 * @returns Integrity report
 */
export function verifyChain(
  entries: Array<{
    timestamp: string;
    sessionId: string;
    agentName: string;
    eventType: string;
    action: string;
    resource: string;
    result: string;
    details: Record<string, unknown>;
    previousHash?: string;
    hash: string;
    id: string;
  }>
): { valid: boolean; brokenAt?: number } {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const prevHash = i === 0 ? '' : entries[i - 1]!.hash;

    // Check previousHash linkage
    const expectedPrevious = i === 0 ? undefined : prevHash;
    if (entry.previousHash !== expectedPrevious) {
      return { valid: false, brokenAt: i };
    }

    // Recompute and verify hash
    const computed = computeEntryHash(
      {
        timestamp: entry.timestamp,
        sessionId: entry.sessionId,
        agentName: entry.agentName,
        eventType: entry.eventType,
        action: entry.action,
        resource: entry.resource,
        result: entry.result,
        details: entry.details,
      },
      prevHash
    );

    if (computed !== entry.hash) {
      return { valid: false, brokenAt: i };
    }
  }

  return { valid: true };
}
