import { describe, it, expect } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai/base";
import { createAuditor, type Auditor, type Finding } from "./audit.js";
import { createEventBus } from "./events.js";

/** 构造合法最小 AssistantMessage。 */
function makeAssistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic" as any,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

/** 构造最小 AgentState（只填 audit 关心的字段）。 */
function makeState(opts: {
  messages: any[];
  pendingToolCalls?: Set<string>;
}): any {
  return {
    messages: opts.messages,
    pendingToolCalls: opts.pendingToolCalls ?? new Set<string>(),
  };
}

describe("createAuditor", () => {
  it("returns an Auditor with scan/subscribe/activeLayers", () => {
    const auditor = createAuditor();
    expect(typeof auditor.scan).toBe("function");
    expect(typeof auditor.subscribe).toBe("function");
    expect(Array.isArray(auditor.activeLayers)).toBe(true);
  });

  it("default activeLayers === ['tool-execution','answer-shaping']", () => {
    const auditor = createAuditor();
    expect(auditor.activeLayers).toEqual(["tool-execution", "answer-shaping"]);
  });

  it("scan is a stub returning [] by default (no throw)", () => {
    const auditor = createAuditor();
    const findings = auditor.scan({ messages: [] } as any, []);
    expect(findings).toEqual([]);
  });

  it("subscribe is a no-op stub (no throw)", () => {
    const auditor = createAuditor();
    expect(() => auditor.subscribe({ on() { return () => {}; }, emit() {} } as any)).not.toThrow();
  });

  it("respects opts.layers override", () => {
    const auditor = createAuditor({ layers: ["tool-execution"] });
    expect(auditor.activeLayers).toEqual(["tool-execution"]);
  });
});

describe("tool-execution checker (layer 7)", () => {
  it("reports a critical finding when assistant toolCall has no matching tool_execution_end event", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        makeAssistantMessage([
          { type: "text", text: "I will run a tool" },
          { type: "toolCall", id: "t1", name: "bash", arguments: {} },
        ]),
      ],
    });
    // 无任何 tool_execution_end event
    const findings = auditor.scan(state, []);
    const tc = findings.find((f) => f.sourceLayer === "tool-execution");
    expect(tc).toBeDefined();
    expect(tc!.severity).toBe("critical");
    expect(tc!.evidenceRefs).toContain("t1");
  });

  it("does not report when a matching tool_execution_end event exists", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        makeAssistantMessage([
          { type: "toolCall", id: "t1", name: "bash", arguments: {} },
        ]),
      ],
    });
    const events = [
      { type: "tool_execution_end", toolCallId: "t1", toolName: "bash", args: {}, result: {}, isError: false },
    ] as any;
    const findings = auditor.scan(state, events);
    expect(findings.some((f) => f.sourceLayer === "tool-execution")).toBe(false);
  });

  it("does not report for aborted turn (stopReason === 'aborted')", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        makeAssistantMessage(
          [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }],
          "aborted",
        ),
      ],
    });
    const findings = auditor.scan(state, []);
    expect(findings.some((f) => f.sourceLayer === "tool-execution")).toBe(false);
  });

  it("does not report for in-flight toolCall (pendingToolCalls non-empty for that id)", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        makeAssistantMessage([
          { type: "toolCall", id: "t1", name: "bash", arguments: {} },
        ]),
      ],
      pendingToolCalls: new Set(["t1"]),
    });
    const findings = auditor.scan(state, []);
    expect(findings.some((f) => f.sourceLayer === "tool-execution")).toBe(false);
  });

  it("reports multiple findings when multiple toolCalls lack execution events", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        makeAssistantMessage([
          { type: "toolCall", id: "t1", name: "bash", arguments: {} },
          { type: "toolCall", id: "t2", name: "read", arguments: {} },
        ]),
      ],
    });
    const findings = auditor.scan(state, []);
    const tcFindings = findings.filter((f) => f.sourceLayer === "tool-execution");
    expect(tcFindings.length).toBe(2);
    const refs = tcFindings.flatMap((f) => f.evidenceRefs);
    expect(refs).toContain("t1");
    expect(refs).toContain("t2");
  });
});

describe("answer-shaping checker (layer 9)", () => {
  it("reports a medium finding when final assistant message content is empty", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        makeAssistantMessage([]),
      ],
    });
    const findings = auditor.scan(state, []);
    const as = findings.find((f) => f.sourceLayer === "answer-shaping");
    expect(as).toBeDefined();
    expect(as!.severity).toBe("medium");
  });

  it("reports a medium finding when final assistant message content is pure whitespace", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        makeAssistantMessage([{ type: "text", text: "   \n\t  " }]),
      ],
    });
    const findings = auditor.scan(state, []);
    const as = findings.find((f) => f.sourceLayer === "answer-shaping");
    expect(as).toBeDefined();
    expect(as!.severity).toBe("medium");
  });

  it("does not report when final assistant message content is non-empty", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        makeAssistantMessage([{ type: "text", text: "Here is the answer." }]),
      ],
    });
    const findings = auditor.scan(state, []);
    expect(findings.some((f) => f.sourceLayer === "answer-shaping")).toBe(false);
  });

  it("does not report when there is no assistant message", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [],
    });
    const findings = auditor.scan(state, []);
    expect(findings.some((f) => f.sourceLayer === "answer-shaping")).toBe(false);
  });

  it("uses the last non-toolCall assistant message as the final answer", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        // earlier assistant message with a toolCall (not the final answer)
        makeAssistantMessage([
          { type: "text", text: "I will run a tool" },
          { type: "toolCall", id: "t1", name: "bash", arguments: {} },
        ]),
        // a matching execution event would normally suppress tool-execution finding;
        // here we focus on answer-shaping: final assistant message is empty
        makeAssistantMessage([]),
      ],
    });
    const findings = auditor.scan(state, [
      { type: "tool_execution_end", toolCallId: "t1", toolName: "bash", args: {}, result: {}, isError: false } as any,
    ]);
    const as = findings.find((f) => f.sourceLayer === "answer-shaping");
    expect(as).toBeDefined();
    expect(as!.severity).toBe("medium");
  });

  it("does not report when the only assistant message contains a toolCall (no final answer yet)", () => {
    const auditor = createAuditor();
    const state = makeState({
      messages: [
        makeAssistantMessage([
          { type: "text", text: "I will run a tool" },
          { type: "toolCall", id: "t1", name: "bash", arguments: {} },
        ]),
      ],
    });
    const findings = auditor.scan(state, [
      { type: "tool_execution_end", toolCallId: "t1", toolName: "bash", args: {}, result: {}, isError: false } as any,
    ]);
    expect(findings.some((f) => f.sourceLayer === "answer-shaping")).toBe(false);
  });
});

describe("subscribe + ring buffer + scan trigger + emit audit_finding", () => {
  it("subscribe accumulates emitted events into an internal buffer (observable via scan after prompt)", () => {
    const events = createEventBus();
    const auditor = createAuditor();
    auditor.subscribe(events);

    // state with a toolCall that has no execution event -> critical finding once buffer has no execution event
    const state = makeState({
      messages: [
        makeAssistantMessage([
          { type: "toolCall", id: "tA", name: "bash", arguments: {} },
        ]),
      ],
    });

    // emit a tool_execution_end for a DIFFERENT id (buffer accumulates, but not matching tA)
    events.emit({
      type: "tool_execution_end",
      toolCallId: "other",
      toolName: "bash",
      args: {},
      result: {},
      isError: false,
    } as any);

    // scan after prompt: should still flag tA (no matching execution event observed)
    const findings = auditor.scan(state, /* recentEvents not required: subscribe buffer used */ []);
    const tc = findings.find((f) => f.sourceLayer === "tool-execution");
    expect(tc).toBeDefined();
    expect(tc!.evidenceRefs).toContain("tA");
  });

  it("emits an audit_finding event per finding produced by scan (severity/finding fields)", () => {
    const events = createEventBus();
    const auditor = createAuditor();

    const received: any[] = [];
    events.on("audit_finding", (ev) => received.push(ev));

    // subscribe wires scan → emit audit_finding per finding (spec §4.4).
    auditor.subscribe(events);

    const state = makeState({
      messages: [
        makeAssistantMessage([
          { type: "toolCall", id: "tB", name: "bash", arguments: {} },
        ]),
      ],
    });
    // harness calls scan after prompt; scan emits one audit_finding per finding.
    const findings = auditor.scan(state, []);
    expect(findings.length).toBeGreaterThan(0);
    expect(received.length).toBe(findings.length);
    for (const ev of received) {
      expect(ev.type).toBe("audit_finding");
      expect(["critical", "high", "medium", "low"]).toContain(ev.severity);
      expect(ev.finding).toBeDefined();
    }
  });

  it("buffer overflow (emit 1001 events) emits exactly one low finding with sourceLayer 'audit-buffer' and title 'event buffer overflow'", () => {
    const events = createEventBus();
    const auditor = createAuditor();

    const overflowFindings: any[] = [];
    events.on("audit_finding", (ev) => overflowFindings.push(ev));

    auditor.subscribe(events);

    // emit 1001 generic events to overflow the ring buffer (cap 1000)
    for (let i = 0; i < 1001; i++) {
      events.emit({
        type: "tool_execution_end",
        toolCallId: `of${i}`,
        toolName: "bash",
        args: {},
        result: {},
        isError: false,
      } as any);
    }

    const overflow = overflowFindings.filter(
      (ev) => (ev.finding as any)?.sourceLayer === "audit-buffer",
    );
    expect(overflow.length).toBe(1);
    expect(overflow[0].severity).toBe("low");
    expect((overflow[0].finding as any).title).toContain("event buffer overflow");
    expect((overflow[0].finding as any).sourceLayer).toBe("audit-buffer");
  });
});
