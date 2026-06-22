import type { HarnessEvent } from "@agentforge/shared";

/**
 * 最小事件总线。见 ARCHITECTURE.md §4.5。
 * emit 按 event.type 同步遍历调用同类 handler；异步 handler 为 fire-and-forget。
 */
export type Unsubscribe = () => void;
export type EventHandler = (event: HarnessEvent) => void;

export interface EventBus {
  on(type: string, handler: EventHandler): Unsubscribe;
  emit(event: HarnessEvent): void;
}

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();

  return {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    },
    emit(event) {
      const set = handlers.get(event.type);
      if (!set) return;
      for (const handler of set) {
        handler(event);
      }
    },
  };
}
