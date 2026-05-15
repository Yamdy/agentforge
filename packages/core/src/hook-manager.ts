import type { Hook, HookPoint, HookProfile } from '@agentforge/sdk';
import type { EventBus } from './event-bus.js';

const DEFAULT_PRIORITY = 100;

const HOOK_TO_EVENT: Record<string, string> = {
  'agent.start': 'agent:start',
  'agent.end': 'agent:end',
  'stage.before': 'stage:before',
  'stage.after': 'stage:after',
  'llm.before': 'llm:before',
  'llm.after': 'llm:after',
  'tool.before': 'tool:before',
  'tool.after': 'tool:after',
  'error': 'error',
};

export interface HookManagerOptions {
  profile?: HookProfile;
  disabledHooks?: string[];
}

export class HookManager {
  private hooks = new Map<HookPoint, Hook[]>();
  private sortedHooks = new Map<HookPoint, Hook[]>();
  private disabledPoints = new Set<HookPoint>();
  private profile: HookProfile = 'standard';
  private disabledHookNames: Set<string>;
  private eventBus: EventBus;

  constructor(eventBus: EventBus, options?: HookManagerOptions) {
    this.eventBus = eventBus;
    if (options?.profile) this.profile = options.profile;
    this.disabledHookNames = new Set(options?.disabledHooks ?? []);
  }

  register(hook: Hook): void {
    let list = this.hooks.get(hook.point);
    if (!list) {
      list = [];
      this.hooks.set(hook.point, list);
    }
    list.push(hook);
    this.sortedHooks.delete(hook.point);
  }

  async invoke(point: HookPoint, input: unknown, output: unknown): Promise<void> {
    if (this.disabledPoints.has(point)) return;

    const hooks = this.getSortedHooks(point);
    if (hooks.length === 0) {
      this.bridge(point, input);
      return;
    }

    // minimal profile: only run error hooks
    if (this.profile === 'minimal' && point !== 'error') {
      this.bridge(point, input);
      return;
    }

    for (const hook of hooks) {
      if (hook.name && this.disabledHookNames.has(hook.name)) continue;

      try {
        await hook.handler(input, output);
      } catch (err) {
        this.eventBus.emit('hook:error', { point, hookName: hook.name, error: err instanceof Error ? err.message : String(err) });
        if (this.profile === 'strict') break; // circuit-break
        // standard: isolate error, continue
      }
    }

    this.bridge(point, input);
  }

  setProfile(profile: HookProfile): void {
    this.profile = profile;
  }

  disablePoint(point: HookPoint): void {
    this.disabledPoints.add(point);
  }

  private getSortedHooks(point: HookPoint): Hook[] {
    const cached = this.sortedHooks.get(point);
    if (cached) return cached;

    const hooks = this.hooks.get(point) ?? [];
    if (hooks.length <= 1) {
      this.sortedHooks.set(point, hooks);
      return hooks;
    }

    const sorted = [...hooks].sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY));
    this.sortedHooks.set(point, sorted);
    return sorted;
  }

  private bridge(point: HookPoint, data: unknown): void {
    const eventType = HOOK_TO_EVENT[point] ?? point.replace('.', ':');
    try {
      this.eventBus.emit(eventType, data);
    } catch {
      // bridge failure is isolated — never affects hook pipeline
    }
  }
}
