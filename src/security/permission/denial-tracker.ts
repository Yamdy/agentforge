/**
 * AgentForge Denial Tracker
 *
 * Tracks tool execution denials for automatic permission downgrade.
 *
 * When a tool is repeatedly denied by the human, the permission system
 * can downgrade from 'ask' mode to 'deny' mode, skipping the approval
 * prompt entirely. This prevents user frustration from repeated prompts
 * for tools they consistently reject.
 *
 * The counter auto-resets after a configurable time window (default 5 min),
 * ensuring temporary patterns don't cause permanent downgrades.
 *
 * @see design/17-SECURITY.md Section 4.1
 */

// ============================================================
// Config Types
// ============================================================

export interface DenialTrackerConfig {
  /** Number of denials before auto-deny kicks in (default: 3) */
  maxDenialsBeforeDowngrade: number;
  /** Action when mode is downgraded (default: 'deny') */
  downgradeAction: 'deny' | 'ask';
  /** Auto-reset counter after this many ms (default: 300000 = 5 min) */
  resetAfterMs: number;
}

export const DEFAULT_DENIAL_TRACKER_CONFIG: DenialTrackerConfig = {
  maxDenialsBeforeDowngrade: 3,
  downgradeAction: 'deny',
  resetAfterMs: 300_000,
};

// ============================================================
// Internal Types
// ============================================================

interface DenialEntry {
  count: number;
  firstDeniedAt: number;
  lastDeniedAt: number;
}

// ============================================================
// DenialTracker
// ============================================================

export class DenialTracker {
  private readonly config: DenialTrackerConfig;
  private readonly entries = new Map<string, DenialEntry>();

  constructor(config?: Partial<DenialTrackerConfig>) {
    this.config = { ...DEFAULT_DENIAL_TRACKER_CONFIG, ...config };
  }

  /**
   * Record a tool being denied by the human.
   * If existing entry has expired, creates a fresh entry.
   */
  recordDenial(toolName: string): void {
    const existing = this.entries.get(toolName);
    const now = Date.now();

    if (!existing) {
      this.entries.set(toolName, {
        count: 1,
        firstDeniedAt: now,
        lastDeniedAt: now,
      });
      return;
    }

    // Check if existing entry has expired — if so, start fresh
    if (now - existing.lastDeniedAt >= this.config.resetAfterMs) {
      this.entries.set(toolName, {
        count: 1,
        firstDeniedAt: now,
        lastDeniedAt: now,
      });
      return;
    }

    existing.count++;
    existing.lastDeniedAt = now;
  }

  /**
   * Check if tool should be auto-denied (too many denials accumulated).
   * Respects the auto-reset window — if last denial was older than
   * resetAfterMs, the counter resets and this returns false.
   */
  shouldAutoDeny(toolName: string): boolean {
    const entry = this.getActiveEntry(toolName);
    if (!entry) return false;
    return entry.count >= this.config.maxDenialsBeforeDowngrade;
  }

  /**
   * Get denial count for a tool.
   * Returns 0 for unknown tools or tools that have been auto-reset.
   */
  getDenialCount(toolName: string): number {
    const entry = this.getActiveEntry(toolName);
    return entry ? entry.count : 0;
  }

  /**
   * Get all tool names that have at least one active denial record.
   */
  getDeniedTools(): string[] {
    const tools: string[] = [];
    const now = Date.now();
    const resetMs = this.config.resetAfterMs;

    for (const [name, entry] of this.entries) {
      if (now - entry.lastDeniedAt < resetMs) {
        tools.push(name);
      }
    }

    return tools;
  }

  /**
   * Check if ANY tool has exceeded the denial threshold,
   * indicating the overall permission mode should be downgraded.
   */
  shouldDowngradeMode(): boolean {
    for (const toolName of this.getDeniedTools()) {
      if (this.shouldAutoDeny(toolName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove tracking for a tool (e.g., after user explicitly allows it).
   */
  reset(toolName: string): void {
    this.entries.delete(toolName);
  }

  /**
   * Clear all denial tracking.
   */
  resetAll(): void {
    this.entries.clear();
  }

  /**
   * Get summary of all active denial records for logging/audit.
   */
  getSummary(): { tool: string; count: number; autoDenied: boolean }[] {
    const summary: { tool: string; count: number; autoDenied: boolean }[] = [];
    const threshold = this.config.maxDenialsBeforeDowngrade;

    for (const toolName of this.getDeniedTools()) {
      const count = this.getDenialCount(toolName);
      summary.push({
        tool: toolName,
        count,
        autoDenied: count >= threshold,
      });
    }

    return summary;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * Get entry if still active (not expired by resetAfterMs).
   * Pure read — does NOT delete expired entries.
   */
  private getActiveEntry(toolName: string): DenialEntry | undefined {
    const entry = this.entries.get(toolName);
    if (!entry) return undefined;

    const elapsed = Date.now() - entry.lastDeniedAt;
    if (elapsed >= this.config.resetAfterMs) {
      return undefined;
    }

    return entry;
  }

  /**
   * Explicitly purge all expired entries from the map.
   * Call at strategic points (e.g., periodically or after batch operations)
   * to prevent unbounded map growth.
   */
  purgeExpired(): void {
    const now = Date.now();
    const resetMs = this.config.resetAfterMs;

    for (const [name, entry] of this.entries) {
      if (now - entry.lastDeniedAt >= resetMs) {
        this.entries.delete(name);
      }
    }
  }
}
