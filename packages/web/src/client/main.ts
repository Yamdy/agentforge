/**
 * client UI（vanilla TS）。pi 借鉴（spec §4.1.1/§5）：
 *  - message_update 整条替换 streaming（reducer 已处理），render 取 streaming.content text
 *  - rAF 合帧（scheduleRender）吸收高频 message_update 刷新（spec §4.1.2，server 不批量）
 *  - WS 断线自动重连 + resume（sessionId）
 */
import { marked } from "marked";
import { reducer, initState, derivePending, type State } from "./reducer.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stream = $("stream"), input = $("input") as HTMLTextAreaElement, form = $("composer") as HTMLFormElement;
const abortBtn = $("abort") as HTMLButtonElement, sendBtn = $("send") as HTMLButtonElement;
const budgetEl = $("budget"), usageEl = $("usage"), errorEl = $("error"), countEl = $("count"), toolsEl = $("tools");

let state: State = initState();
let sessionId: string | null = null;
let ws: WebSocket | null = null;
let rafScheduled = false;
let stateSeq = 0;

/** streaming 是 AssistantMessage（pi 借鉴，整条累积态），取首个 text content 渲染。 */
function streamingText(): string {
  const c = state.streaming?.content?.find((b) => b.type === "text");
  return c?.text ?? "";
}

/** 工具 args 简短摘要（try/catch 兜底循环/BigInt，red-team F4）。 */
function formatArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args) ?? "";
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  } catch {
    return "[unserializable]";
  }
}

function render() {
  rafScheduled = false;
  stream.innerHTML = "";
  for (const m of state.messages) {
    const div = document.createElement("div");
    if (m.role === "tool") {
      const cls = m.status === "error" || m.isError ? "error" : "done";
      div.className = `msg tool ${cls}`;
      const icon = m.status === "error" ? "⚠" : m.isError ? "✗" : "✓";
      div.textContent = `${icon} ${m.toolName} ${formatArgs(m.args)}`;
    } else {
      div.className = `msg ${m.role === "user" ? "user" : "assistant"}`;
      div.innerHTML = marked.parse(m.text) as string;
    }
    stream.appendChild(div);
  }
  if (state.streaming) {
    const div = document.createElement("div");
    div.className = "msg assistant streaming";
    div.innerHTML = marked.parse(streamingText()) as string;
    stream.appendChild(div);
  }
  // pending 占位（streaming 的 toolCall / 定稿未执行 toolCall），渲染在 streaming 之后（F6：assistant 先说话再调工具）
  const pending = derivePending(state.messages, state.streaming);
  for (const p of pending) {
    const div = document.createElement("div");
    div.className = "msg tool pending";
    div.textContent = `⏳ ${p.toolName} ${formatArgs(p.args)}`;
    stream.appendChild(div);
  }
  stream.scrollTop = stream.scrollHeight;
  sendBtn.hidden = state.busy;
  abortBtn.hidden = !state.busy;
  budgetEl.textContent = state.budget ? `token: ${state.budget.total} / headroom ${state.budget.headroom}` : "—";
  countEl.textContent = state.messageCount != null ? `msgs: ${state.messageCount}` : "";
  const done = state.messages.filter((m) => m.role === "tool" && !m.isError).length;
  const err = state.messages.filter((m) => m.role === "tool" && m.isError).length;
  toolsEl.textContent = `tools: ✓${done} ⚠${err} ⏳${pending.length}`;
  usageEl.textContent = state.lastUsage ? `in ${state.lastUsage.input ?? 0} / out ${state.lastUsage.output ?? 0}` : "";
  errorEl.textContent = state.error ?? "";
}

function scheduleRender() { if (!rafScheduled) { rafScheduled = true; requestAnimationFrame(render); } }

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    if (e.type === "resumed") sessionId = e.sessionId;
    state = reducer(state, e);
    scheduleRender();
  };
  ws.onopen = () => {
    ws!.send(JSON.stringify({ method: "get_state", id: String(++stateSeq) }));
    if (sessionId) ws!.send(JSON.stringify({ method: "resume", sessionId }));
  };
  ws.onclose = () => { setTimeout(connect, 1000); };
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !ws || state.busy) return;
  // 不乐观 push user 消息：pi runAgentLoop 对每个 user prompt 同步发 message_end(user)（agent-loop.ts:113，LLM 调用前），
  // server 转发 → reducer 定稿。server 事件流是消息唯一来源（spec §5.3）；乐观 push 会与 message_end(user) 重复显示。
  state = { ...state, busy: true };
  scheduleRender();
  ws.send(JSON.stringify({ method: "prompt", input: text }));
  input.value = "";
});

// Ctrl/Cmd+Enter 提交（textarea 内 Enter 默认换行不提交，spec §5.2 Composer）。
input.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    form.requestSubmit();
  }
});

abortBtn.addEventListener("click", () => ws?.send(JSON.stringify({ method: "abort" })));
connect();
