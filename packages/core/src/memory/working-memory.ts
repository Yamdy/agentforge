import type { WorkingMemory } from './types.js';

const DEFAULT_TEMPLATE = '## Working Memory\n\n{{profile}}\n\n{{taskState}}';

export class WorkingMemoryImpl {
  private data: WorkingMemory;

  constructor(initial?: WorkingMemory) {
    this.data = initial ?? {
      userProfile: { preferences: {}, goals: [], constraints: [] },
      taskState: { currentGoal: '', progress: 0, blockers: [], nextSteps: [] },
      injection: { template: DEFAULT_TEMPLATE, scope: 'thread' },
    };
  }

  // ── Profile ────────────────────────────────────────────────

  getProfile(): WorkingMemory['userProfile'] {
    return this.data.userProfile;
  }

  setProfileField<K extends keyof WorkingMemory['userProfile']>(
    key: K,
    value: WorkingMemory['userProfile'][K],
  ): void {
    this.data.userProfile[key] = value;
  }

  addGoal(goal: string): void {
    if (!this.data.userProfile.goals.includes(goal)) {
      this.data.userProfile.goals.push(goal);
    }
  }

  removeGoal(goal: string): void {
    this.data.userProfile.goals = this.data.userProfile.goals.filter((g) => g !== goal);
  }

  addConstraint(constraint: string): void {
    if (!this.data.userProfile.constraints.includes(constraint)) {
      this.data.userProfile.constraints.push(constraint);
    }
  }

  removeConstraint(constraint: string): void {
    this.data.userProfile.constraints = this.data.userProfile.constraints.filter((c) => c !== constraint);
  }

  // ── Task State ─────────────────────────────────────────────

  getTaskState(): WorkingMemory['taskState'] {
    return this.data.taskState;
  }

  setCurrentGoal(goal: string): void {
    this.data.taskState.currentGoal = goal;
  }

  updateProgress(progress: number): void {
    this.data.taskState.progress = Math.max(0, Math.min(100, progress));
  }

  addBlocker(blocker: string): void {
    if (!this.data.taskState.blockers.includes(blocker)) {
      this.data.taskState.blockers.push(blocker);
    }
  }

  removeBlocker(blocker: string): void {
    this.data.taskState.blockers = this.data.taskState.blockers.filter((b) => b !== blocker);
  }

  setNextSteps(steps: string[]): void {
    this.data.taskState.nextSteps = steps;
  }

  resetTaskState(): void {
    this.data.taskState = { currentGoal: '', progress: 0, blockers: [], nextSteps: [] };
  }

  // ── Injection ──────────────────────────────────────────────

  toInjection(scope: 'thread' | 'resource'): string {
    const p = this.data.userProfile;
    const t = this.data.taskState;

    const profileParts: string[] = [];
    if (p.name) profileParts.push(`**User**: ${p.name}`);
    if (p.goals.length > 0) profileParts.push(`**Goals**: ${p.goals.join(', ')}`);
    if (p.constraints.length > 0) profileParts.push(`**Constraints**: ${p.constraints.join(', ')}`);
    const profileSection = profileParts.join('\n');

    const taskLines: string[] = [];
    if (t.currentGoal) taskLines.push(`- Current Goal: ${t.currentGoal}`);
    if (t.progress > 0) taskLines.push(`- Progress: ${t.progress}%`);
    if (t.blockers.length > 0) taskLines.push(`- Blockers: ${t.blockers.join(', ')}`);
    if (t.nextSteps.length > 0) taskLines.push(`- Next Steps: ${t.nextSteps.join(', ')}`);
    const taskSection = taskLines.join('\n');

    if (scope === 'resource') {
      const compact: string[] = [];
      if (p.name) compact.push(`User: ${p.name}`);
      if (t.currentGoal) compact.push(`Goal: ${t.currentGoal} (${t.progress}%)`);
      return compact.join(' | ');
    }

    const template = this.data.injection.template;
    return template
      .replace('{{profile}}', profileSection)
      .replace('{{taskState}}', taskSection);
  }

  // ── Serialization ──────────────────────────────────────────

  toJSON(): WorkingMemory {
    return JSON.parse(JSON.stringify(this.data)) as WorkingMemory;
  }

  static fromJSON(data: WorkingMemory): WorkingMemoryImpl {
    return new WorkingMemoryImpl(data);
  }
}
