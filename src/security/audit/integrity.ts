/**
 * AgentForge Audit Integrity
 */

import { createHash } from 'node:crypto';
import type { AuditEntry } from './audit-logger.js';

export interface IntegrityHash {
  index: number;
  hash: string;
  previousHash: string;
}

export interface IntegrityVerificationResult {
  valid: boolean;
  firstInvalidIndex?: number;
  entriesChecked: number;
  reason?: string;
}

export function computeEntryHash(entry: AuditEntry, previousHash: string): string {
  const data = [
    entry.timestamp,
    entry.sessionId,
    entry.agentName,
    entry.eventType,
    entry.action,
    entry.resource,
    entry.result,
    JSON.stringify(entry.details),
    previousHash,
  ].join('|');

  return createHash('sha256').update(data).digest('hex');
}

export function buildHashChain(entries: AuditEntry[]): IntegrityHash[] {
  const hashes: IntegrityHash[] = [];
  let previousHash = '';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const hash = computeEntryHash(entry, previousHash);
    hashes.push({ index: i, hash, previousHash });
    previousHash = hash;
  }

  return hashes;
}

export function verifyIntegrityChain(
  entries: AuditEntry[],
  storedHashes: IntegrityHash[]
): IntegrityVerificationResult {
  if (entries.length !== storedHashes.length) {
    return {
      valid: false,
      entriesChecked: 0,
      reason: `Entry count mismatch: ${entries.length} vs ${storedHashes.length}`,
    };
  }

  let previousHash = '';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const storedHash = storedHashes[i];
    if (!entry || !storedHash) continue;

    const computedHash = computeEntryHash(entry, previousHash);

    if (computedHash !== storedHash.hash) {
      return {
        valid: false,
        firstInvalidIndex: i,
        entriesChecked: i + 1,
        reason: `Hash mismatch at index ${i}: computed ${computedHash} vs stored ${storedHash.hash}`,
      };
    }

    if (storedHash.previousHash !== previousHash) {
      return {
        valid: false,
        firstInvalidIndex: i,
        entriesChecked: i + 1,
        reason: `Previous hash mismatch at index ${i}: stored ${storedHash.previousHash} vs expected ${previousHash}`,
      };
    }

    previousHash = computedHash;
  }

  return { valid: true, entriesChecked: entries.length };
}
