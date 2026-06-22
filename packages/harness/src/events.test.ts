import { describe, test, expect, vi } from "vitest";
import {
  createEventBus,
  type Unsubscribe,
  type EventHandler,
} from "./events.js";
import type { HarnessEvent } from "@agentforge/shared";

describe("EventBus", () => {
  test("emit dispatches an event to handler registered for its type", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("agent_start", handler);

    const event = { type: "agent_start" } as HarnessEvent;
    bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  test("on returns an unsubscribe function that stops further delivery", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const unsubscribe: Unsubscribe = bus.on("agent_end", handler);

    const event = { type: "agent_end", messages: [] } as HarnessEvent;
    bus.emit(event);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.emit(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("multiple handlers registered for the same type all receive the event", () => {
    const bus = createEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.on("agent_start", handler1);
    bus.on("agent_start", handler2);

    const event = { type: "agent_start" } as HarnessEvent;
    bus.emit(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });

  test("handlers registered for one type do not receive events of another type", () => {
    const bus = createEventBus();
    const agentEndHandler: EventHandler = vi.fn();
    bus.on("agent_end", agentEndHandler);

    bus.emit({ type: "agent_start" } as HarnessEvent);

    expect(agentEndHandler).not.toHaveBeenCalled();
  });
});
