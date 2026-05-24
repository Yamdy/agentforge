import type { MutabilityDomain, MutabilityLevel, MutabilityPolicy } from '@primo-ai/sdk';

type PolicyChangeListener = (policy: MutabilityPolicy) => void;

const DEFAULT_POLICY: MutabilityPolicy = {
  pipeline: 'frozen',
  processors: 'frozen',
  plugins: 'frozen',
  tools: 'frozen',
  hotReload: false,
  watchConfig: false,
};

export class MutabilityPolicyEngine {
  private _policy: MutabilityPolicy;
  private listeners: PolicyChangeListener[] = [];

  constructor(policy?: MutabilityPolicy | MutabilityLevel) {
    if (!policy) {
      this._policy = { ...DEFAULT_POLICY };
    } else if (typeof policy === 'string') {
      this._policy = {
        pipeline: policy,
        processors: policy,
        plugins: policy,
        tools: policy,
        hotReload: policy !== 'frozen',
        watchConfig: false,
      };
    } else {
      this._policy = { ...DEFAULT_POLICY, ...policy };
    }
  }

  get policy(): MutabilityPolicy {
    return this._policy;
  }

  isMutable(domain: MutabilityDomain, _state?: string): boolean {
    const level = this._policy[domain];
    return level !== 'frozen';
  }

  canApplyDirectly(domain: MutabilityDomain): boolean {
    return this._policy[domain] === 'dynamic';
  }

  canApplyViaReload(domain: MutabilityDomain): boolean {
    const level = this._policy[domain];
    return level === 'configOnly' || level === 'dynamic';
  }

  updatePolicy(partial: Partial<MutabilityPolicy>): void {
    const changed = Object.entries(partial).some(
      ([k, v]) => (this._policy as any)[k] !== v,
    );
    Object.assign(this._policy, partial);
    if (changed) {
      for (const cb of this.listeners) cb(this._policy);
    }
  }

  onPolicyChange(cb: PolicyChangeListener): () => void {
    this.listeners.push(cb);
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
}
