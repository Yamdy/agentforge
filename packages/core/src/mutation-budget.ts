import type { MutationBudgetConfig, MutationBudgetState } from '@primo-ai/sdk';

export interface MutationBudgetOptions extends MutationBudgetConfig {
  onEvent?: (event: string) => void;
}

interface ConsumeResult {
  allowed: boolean;
  reason?: string;
}

export class MutationBudgetEngine {
  private config: MutationBudgetOptions;
  private _state: MutationBudgetState;

  constructor(config: MutationBudgetOptions) {
    this.config = config;
    const now = Date.now();
    this._state = {
      hourlyCount: 0,
      hourlyResetAt: now + 3600000,
      dailyCount: 0,
      dailyResetAt: now + 86400000,
      lastMutationAt: 0,
    };
  }

  get state(): MutationBudgetState {
    return this._state;
  }

  tryConsume(diff: { files: number; linesPerFile: number }): ConsumeResult {
    const now = Date.now();

    if (now >= this._state.hourlyResetAt) {
      this._state.hourlyCount = 0;
      this._state.hourlyResetAt = now + 3600000;
    }

    if (now >= this._state.dailyResetAt) {
      this._state.dailyCount = 0;
      this._state.dailyResetAt = now + 86400000;
    }

    if (diff.files > this.config.maxFilesPerMutation) {
      return { allowed: false, reason: `files: ${diff.files} > maxFilesPerMutation: ${this.config.maxFilesPerMutation}` };
    }

    if (diff.linesPerFile > this.config.maxDiffLinesPerMutation) {
      return { allowed: false, reason: `lines: ${diff.linesPerFile} > maxDiffLinesPerMutation: ${this.config.maxDiffLinesPerMutation}` };
    }

    if (this._state.lastMutationAt > 0 && (now - this._state.lastMutationAt) < this.config.cooldownMs) {
      return { allowed: false, reason: `cooldown: ${this.config.cooldownMs - (now - this._state.lastMutationAt)}ms remaining` };
    }

    if (this._state.hourlyCount >= this.config.maxMutationsPerHour) {
      this.config.onEvent?.('budget:exceeded');
      return { allowed: false, reason: `hourly: ${this._state.hourlyCount} >= maxMutationsPerHour: ${this.config.maxMutationsPerHour}` };
    }

    if (this._state.dailyCount >= this.config.maxMutationsPerDay) {
      this.config.onEvent?.('budget:exceeded');
      return { allowed: false, reason: `daily: ${this._state.dailyCount} >= maxMutationsPerDay: ${this.config.maxMutationsPerDay}` };
    }

    this._state.hourlyCount++;
    this._state.dailyCount++;
    this._state.lastMutationAt = now;

    return { allowed: true };
  }

  forceSetState(state: MutationBudgetState): void {
    this._state = { ...state };
  }
}
