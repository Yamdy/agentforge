import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUiServer } from "./index.js";

/**
 * 最小 AssistantMessageEventStream mock：异步可迭代 + .result()。
 *
 * 背景：AgentForgeHarness 把 streamFn 注入 pi Agent；pi agent-loop 对 streamFn
 * 返回值做 `for await (event of response)` 且在 done/error 后调 `response.result()`。
 * 故 streamFn 不能是裸 async generator（缺 .result() 会在 done 时抛错）。
 * 此 mock 复刻 pi AssistantMessageEventStream 的契约（start/text_delta/done），
 * 让 harness 正常产出 message_update + agent_end，验证 server 转发逻辑。
 */
function makeStream(events: Array<Record<string, unknown>>) {
  const queue = [...events];
  let finalMessage: Record<string, unknown> | null = null;
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of queue) {
        if (e.type === "done") finalMessage = e.message as Record<string, unknown>;
        yield e;
      }
    },
    async result() {
      return finalMessage;
    },
  };
}

/** 构造最小 AssistantMessage（满足 pi agent-loop 字段需求）。 */
function msg(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("startUiServer", () => {
  it("prompt 后 WS 收到 message_update（转发 message）+ agent_end", async () => {
    const hel = msg("hel");
    const hello = msg("hello");
    const streamFn = vi.fn(() => makeStream([
      { type: "start", partial: hel },
      { type: "text_delta", contentIndex: 0, delta: "hel", partial: hel },
      { type: "text_delta", contentIndex: 0, delta: "lo", partial: hello },
      { type: "done", reason: "stop", message: hello },
    ]));
    const server = await startUiServer([], { streamFn, getApiKey: () => "test-key", port: 0 });
    try {
      const WebSocket = (await import("ws")).WebSocket;
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      const received: any[] = await new Promise((resolve) => {
        const buf: any[] = [];
        ws.on("open", () => ws.send(JSON.stringify({ method: "prompt", input: "hi" })));
        ws.on("message", (d) => {
          buf.push(JSON.parse(d.toString()));
          if (buf.some((m) => m.type === "agent_end")) resolve(buf);
        });
      });
      const updates = received.filter((m) => m.type === "message_update");
      expect(updates.length).toBe(2);
      expect(updates[1].message.content[0].text).toBe("hello"); // 最后一条累积态
      expect(updates.every((m) => m.assistantMessageEvent === undefined)).toBe(true); // 丢 assistantMessageEvent
      expect(received.some((m) => m.type === "agent_end")).toBe(true);
      ws.close();
    } finally {
      await server.close();
    }
  }, 15000);

  it("abort 后 WS 收到 error 且不锁死（可再 prompt）", async () => {
    let calls = 0;
    const hello = msg("ok");
    const streamFn = vi.fn((_model: unknown, _ctx: unknown, opts: { signal?: AbortSignal } = {}) => {
      calls++;
      // 第 1 次：start 后挂起，等 abort signal → push error 让 agent loop 退出。
      // pi agent-loop 收 error 事件后结束 turn（stopReason "aborted"），harness.prompt
      // 见 signal.aborted 抛 "aborted" → server handlePrompt catch 发 error，busy 复位。
      // 第 2 次：正常 start + done，产出 agent_end。
      if (calls === 1) {
        const partial = msg("");
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "start", partial };
            // 不主动 done；等 abort。
            await new Promise<void>((resolve) => {
              if (opts.signal?.aborted) return resolve();
              opts.signal?.addEventListener("abort", () => resolve(), { once: true });
            });
            yield { type: "error", reason: "aborted", error: { ...partial, stopReason: "aborted", errorMessage: "aborted" } };
          },
          async result() {
            return { ...partial, stopReason: "aborted", errorMessage: "aborted" };
          },
        };
      }
      return makeStream([
        { type: "start", partial: hello },
        { type: "done", reason: "stop", message: hello },
      ]);
    });
    const server = await startUiServer([], { streamFn, getApiKey: () => "k", port: 0 });
    try {
      const WebSocket = (await import("ws")).WebSocket;
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((r) => ws.on("open", () => r()));
      const first = new Promise<any[]>((resolve) => {
        const buf: any[] = [];
        const h = (d: any) => { buf.push(JSON.parse(d.toString())); if (buf.some((m) => m.type === "error")) { ws.off("message", h); resolve(buf); } };
        ws.on("message", h);
      });
      ws.send(JSON.stringify({ method: "prompt", input: "x" }));
      // 等 stream 进入挂起态后发 abort（短延迟确保 start 已 emit）。
      await new Promise((r) => setTimeout(r, 100));
      ws.send(JSON.stringify({ method: "abort" }));
      const got = await first;
      expect(got.some((m) => m.type === "error")).toBe(true);
      // 再发一次，不锁死
      const second = new Promise<boolean>((resolve) => {
        const h = (d: any) => { if (JSON.parse(d.toString()).type === "agent_end") { ws.off("message", h); resolve(true); } };
        ws.on("message", h);
      });
      ws.send(JSON.stringify({ method: "prompt", input: "y" }));
      expect(await second).toBe(true);
      ws.close();
    } finally {
      await server.close();
    }
  }, 15000);

  it("prompt 经 harness subscribe 转发 agent_start + agent_end 到 wire（不靠 server 合成）", async () => {
    const hello = msg("hello");
    const streamFn = vi.fn(() => makeStream([
      { type: "start", partial: hello },
      { type: "done", reason: "stop", message: hello },
    ]));
    const server = await startUiServer([], { streamFn, getApiKey: () => "test-key", port: 0 });
    try {
      const WebSocket = (await import("ws")).WebSocket;
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      const received: any[] = await new Promise((resolve) => {
        const buf: any[] = [];
        ws.on("open", () => ws.send(JSON.stringify({ method: "prompt", input: "hi" })));
        ws.on("message", (d) => {
          const m = JSON.parse(d.toString());
          buf.push(m);
          if (buf.some((mm) => mm.type === "agent_end")) resolve(buf);
        });
      });
      // agent_start / agent_end 均由 harness 经 subscribe 转发上 wire
      expect(received.some((m) => m.type === "agent_start")).toBe(true);
      expect(received.some((m) => m.type === "agent_end")).toBe(true);
      // 顺序：agent_start 先于 agent_end（harness 生命周期 start→...→end）
      const startIdx = received.findIndex((m) => m.type === "agent_start");
      const endIdx = received.findIndex((m) => m.type === "agent_end");
      expect(startIdx).toBeLessThan(endIdx);
      // 删除合成后每个生命周期事件恰一条（删除前双发，此断言红 → 驱动删 L56/L60）
      expect(received.filter((m) => m.type === "agent_start").length).toBe(1);
      expect(received.filter((m) => m.type === "agent_end").length).toBe(1);
      ws.close();
    } finally {
      await server.close();
    }
  }, 15000);

  it("get_state 返回 5 字段快照 + id 透传 + messageCount=transcript 长度", async () => {
    const hello = msg("hello");
    const streamFn = vi.fn(() => makeStream([
      { type: "start", partial: hello },
      { type: "done", reason: "stop", message: hello },
    ]));
    const server = await startUiServer([], { streamFn, getApiKey: () => "k", port: 0 });
    try {
      const WebSocket = (await import("ws")).WebSocket;
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((r) => ws.on("open", () => r()));
      const state1 = await new Promise<any>((resolve) => {
        ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "state") resolve(m); });
        ws.send(JSON.stringify({ method: "get_state", id: "q1" }));
      });
      expect(state1.id).toBe("q1");
      expect(state1.isStreaming).toBe(false);
      expect(state1.isCompacting).toBe(false);
      expect(state1.pendingMessageCount).toBe(0);
      expect(state1.messageCount).toBe(0);
      expect(typeof state1.sessionId).toBe("string");
      // prompt 后 messageCount 增长（user + assistant = 2）
      await new Promise<void>((resolve) => {
        ws.on("message", (d) => { if (JSON.parse(d.toString()).type === "agent_end") resolve(); });
        ws.send(JSON.stringify({ method: "prompt", input: "hi" }));
      });
      const state2 = await new Promise<any>((resolve) => {
        ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "state") resolve(m); });
        ws.send(JSON.stringify({ method: "get_state" }));
      });
      expect(state2.messageCount).toBe(2);
      ws.close();
    } finally {
      await server.close();
    }
  }, 15000);

  it("resume 后 get_state 返回新 sessionId（修 handleResume 未更新 bug）", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "af-resume-"));
    // 预置一个 session 文件（createJsonlSession + appendEntry，entry 格式对照 @agentforge/shared MessageEntry）
    const { createJsonlSession } = await import("@agentforge/harness");
    const sess = createJsonlSession(join(sessionDir, "preexist.jsonl"));
    sess.appendEntry({
      entryId: "e1", parentId: null, timestamp: 1, type: "message",
      role: "user", content: [{ type: "text", text: "hi" }],
    } as any);
    const hello = msg("ok");
    const streamFn = vi.fn(() => makeStream([
      { type: "start", partial: hello },
      { type: "done", reason: "stop", message: hello },
    ]));
    const server = await startUiServer([], { streamFn, getApiKey: () => "k", port: 0, sessionDir });
    try {
      const WebSocket = (await import("ws")).WebSocket;
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((r) => ws.on("open", () => r()));
      await new Promise<void>((resolve) => {
        ws.on("message", (d) => { if (JSON.parse(d.toString()).type === "resumed") resolve(); });
        ws.send(JSON.stringify({ method: "resume", sessionId: "preexist" }));
      });
      const state = await new Promise<any>((resolve) => {
        ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "state") resolve(m); });
        ws.send(JSON.stringify({ method: "get_state" }));
      });
      expect(state.sessionId).toBe("preexist");
      expect(state.messageCount).toBe(1); // rebuildMessages 重建 1 条历史
      ws.close();
    } finally {
      await server.close();
    }
  }, 15000);

  it("get_state 只读：busy 期间调不打断 turn（isStreaming=true）", async () => {
    const hello = msg("hello");
    const streamFn = vi.fn(() => makeStream([
      { type: "start", partial: hello },
      { type: "done", reason: "stop", message: hello },
    ]));
    const server = await startUiServer([], { streamFn, getApiKey: () => "k", port: 0 });
    try {
      const WebSocket = (await import("ws")).WebSocket;
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((r) => ws.on("open", () => r()));
      // 先挂 agent_end 监听（同步 mock turn 极快，晚挂会错过事件）
      const ended = new Promise<boolean>((resolve) => {
        ws.on("message", (d) => { if (JSON.parse(d.toString()).type === "agent_end") resolve(true); });
      });
      // 发 prompt 后立即 get_state（turn 进行中）
      ws.send(JSON.stringify({ method: "prompt", input: "hi" }));
      const state = await new Promise<any>((resolve) => {
        ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "state") resolve(m); });
        ws.send(JSON.stringify({ method: "get_state" }));
      });
      expect(state.isStreaming).toBe(true);
      // turn 仍正常完成
      expect(await ended).toBe(true);
      ws.close();
    } finally {
      await server.close();
    }
  }, 15000);
});
