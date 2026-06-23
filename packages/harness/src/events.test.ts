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

  test("wildcard '*' handler receives every emitted event regardless of type", () => {
    const bus = createEventBus();
    const wildcard = vi.fn();
    bus.on("*", wildcard);

    const start = { type: "agent_start" } as HarnessEvent;
    const end = { type: "agent_end", messages: [] } as HarnessEvent;
    const toolEnd = { type: "tool_execution_end", toolCallId: "tc-1" } as HarnessEvent;
    bus.emit(start);
    bus.emit(end);
    bus.emit(toolEnd);

    expect(wildcard).toHaveBeenCalledTimes(3);
    expect(wildcard).toHaveBeenNthCalledWith(1, start);
    expect(wildcard).toHaveBeenNthCalledWith(2, end);
    expect(wildcard).toHaveBeenNthCalledWith(3, toolEnd);
  });

  test("wildcard handler receives events in addition to type-specific handlers", () => {
    const bus = createEventBus();
    const specific = vi.fn();
    const wildcard = vi.fn();
    bus.on("agent_start", specific);
    bus.on("*", wildcard);

    const event = { type: "agent_start" } as HarnessEvent;
    bus.emit(event);

    expect(specific).toHaveBeenCalledWith(event);
    expect(wildcard).toHaveBeenCalledWith(event);
  });

  test("wildcard handler stops receiving after unsubscribe", () => {
    const bus = createEventBus();
    const wildcard = vi.fn();
    const unsubscribe = bus.on("*", wildcard);

    bus.emit({ type: "agent_start" } as HarnessEvent);
    expect(wildcard).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.emit({ type: "agent_end", messages: [] } as HarnessEvent);
    expect(wildcard).toHaveBeenCalledTimes(1);
  });
});
