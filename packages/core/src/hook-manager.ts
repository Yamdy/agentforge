import type { Hook, CompositeHook, HookPoint, HookProfile } from '@primo-ai/sdk';
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
  'iteration.end': 'iteration:end',
  'error': 'error',
};

export interface HookManagerOptions {
  profile?: HookProfile;
  disabledHooks?: string[];
}

export class HookManager {
  private hooks = new Map<HookPoint, Hook[]>();
  private compositeHooks = new Map<HookPoint, CompositeHook[]>();
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

  register(hook: Hook | CompositeHook): void {
    if ('hooks' in hook) {
      // CompositeHook — all sub-hooks share the same point
      const point = hook.hooks[0]?.point;
      if (!point) return;
      let list = this.compositeHooks.get(point);
      if (!list) {
        list = [];
        this.compositeHooks.set(point, list);
      }
      list.push(hook);
    } else {
      // Regular Hook
      let list = this.hooks.get(hook.point);
      if (!list) {
        list = [];
        this.hooks.set(hook.point, list);
      }
      list.push(hook);
      this.sortedHooks.delete(hook.point);
    }
  }

  async invoke(point: HookPoint, input: unknown, output: unknown): Promise<unknown[]> {
    if (this.disabledPoints.has(point)) return [];

    // minimal profile: only run error hooks (applies to both individual and composite)
    if (this.profile === 'minimal' && point !== 'error') {
      this.bridge(point, input);
      return [];
    }

    const results: unknown[] = [];

    // 1. Run individual (non-composite) hooks
    const individualHooks = this.getSortedHooks(point);
    if (individualHooks.length > 0) {
      for (const hook of individualHooks) {
        if (hook.name && this.disabledHookNames.has(hook.name)) continue;

        try {
          await hook.handler(input, output);
          results.push(undefined);
        } catch (err) {
          this.eventBus.emit('hook:error', { point, hookName: hook.name, error: err instanceof Error ? err.message : String(err) });
          if (this.profile === 'strict') break;
          // standard: isolate error, continue
        }
      }
    }

    // 2. Run composite hooks registered at this point
    const composites = this.compositeHooks.get(point);
    if (composites && composites.length > 0) {
      for (const composite of composites) {
        const compositeResults = await this.runComposite(composite, input, output);
        results.push(...compositeResults);
      }
    }

    this.bridge(point, input);
    return results;
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

  private async runComposite(
    composite: CompositeHook,
    input: unknown,
    output: unknown,
  ): Promise<unknown[]> {
    const { hooks, mode } = composite;
    const activeHooks = hooks.filter(
      h => !(h.name && this.disabledHookNames.has(h.name)),
    );
    if (activeHooks.length === 0) return [];

    // Sort by priority (ascending — lower number runs first) for ordered modes
    const sortedHooks = (mode === 'sequential' || mode === 'first-wins')
      ? [...activeHooks].sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY))
      : activeHooks;

    switch (mode) {
      case 'parallel': {
        // In strict profile, run sequentially and circuit-break on error
        if (this.profile === 'strict') {
          const results: unknown[] = [];
          for (const hook of sortedHooks) {
            try {
              await hook.handler(input, output);
              results.push(undefined);
            } catch {
              break;
            }
          }
          return results;
        }

        // Standard/minimal: run all with error isolation
        const settled = await Promise.allSettled(
          sortedHooks.map(hook =>
            (async () => {
              await hook.handler(input, output);
            })(),
          ),
        );

        // Emit errors for rejected hooks
        for (let i = 0; i < settled.length; i++) {
          const s = settled[i]!;
          if (s.status === 'rejected') {
            this.eventBus.emit('hook:error', {
              point: sortedHooks[i]!.point,
              hookName: sortedHooks[i]!.name,
              error: s.reason instanceof Error ? s.reason.message : String(s.reason),
            });
          }
        }

        return settled.map(s => (s.status === 'fulfilled' ? s.value : undefined));
      }

      case 'sequential': {
        const results: unknown[] = [];
        for (const hook of sortedHooks) {
          try {
            await hook.handler(input, output);
            results.push(undefined);
          } catch (err) {
            this.eventBus.emit('hook:error', {
              point: hook.point,
              hookName: hook.name,
              error: err instanceof Error ? err.message : String(err),
            });
            if (this.profile === 'strict') break;
            // standard: isolate error, continue
          }
        }
        return results;
      }

      case 'first-wins': {
        for (const hook of sortedHooks) {
          try {
            const result = await hook.handler(input, output);
            return [result]; // First hook that completes without error wins
          } catch (err) {
            this.eventBus.emit('hook:error', {
              point: hook.point,
              hookName: hook.name,
              error: err instanceof Error ? err.message : String(err),
            });
            if (this.profile === 'strict') break;
            // standard: try next hook
          }
        }
        return []; // All hooks failed
      }
    }
  }
}
