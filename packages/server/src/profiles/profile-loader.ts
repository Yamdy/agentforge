import type { AgentProfile } from '@agentforge/sdk';

export class ProfileLoader {
  private profiles = new Map<string, AgentProfile>();

  register(profile: AgentProfile): void {
    this.profiles.set(profile.name, profile);
  }

  load(name: string): AgentProfile {
    const profile = this.profiles.get(name);
    if (!profile) throw new Error(`Unknown profile: "${name}". Available: ${this.list().join(', ')}`);
    if (profile.extends) {
      const parent = this.load(profile.extends);
      return mergeProfiles(parent, profile);
    }
    return profile;
  }

  list(): string[] {
    return Array.from(this.profiles.keys());
  }
}

export function mergeProfiles(base: AgentProfile, override: AgentProfile): AgentProfile {
  return {
    ...base,
    ...override,
    plugins: [...(base.plugins ?? []), ...(override.plugins ?? [])],
    tools: [...(base.tools ?? []), ...(override.tools ?? [])],
    config: { ...base.config, ...override.config },
  };
}
