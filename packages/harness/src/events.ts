import type { HarnessEvent } from "@agentforge/shared";

/**
 * 最小事件总线。见 ARCHITECTURE.md §4.5。
 * emit 按 event.type 同步遍历调用同类 handler；异步 handler 为 fire-and-forget。
 *
 * 通配符：type === "*" 注册的 handler 接收所有 emit 的事件（除 type-specific handler 外
 * 也触发 "*" handler）。供 RPC 等外部消费者订阅全部 harness 事件。
 */
export type Unsubscribe = () => void;
export type EventHandler = (event: HarnessEvent) => void;

/** 通配符 type：注册后接收所有 emit 的事件。 */
export const WILDCARD_TYPE = "*";

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
      if (set) {
        for (const handler of set) {
          handler(event);
        }
      }
      // 通配符 handler 接收所有事件。
      const wildcard = handlers.get(WILDCARD_TYPE);
      if (wildcard) {
        for (const handler of wildcard) {
          handler(event);
        }
      }
    },
  };
}
