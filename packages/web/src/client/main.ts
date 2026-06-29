/**
 * client UI（vanilla TS）。pi 借鉴（spec §4.1.1/§5）：
 *  - message_update 整条替换 streaming（reducer 已处理），render 取 streaming.content text
 *  - rAF 合帧（scheduleRender）吸收高频 message_update 刷新（spec §4.1.2，server 不批量）
 *  - WS 断线自动重连 + resume（sessionId）
 */
import { marked } from "marked";
import { reducer, initState, type State } from "./reducer.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stream = $("stream"), input = $("input") as HTMLTextAreaElement, form = $("composer") as HTMLFormElement;
const abortBtn = $("abort") as HTMLButtonElement, sendBtn = $("send") as HTMLButtonElement;
const budgetEl = $("budget"), usageEl = $("usage"), errorEl = $("error");

let state: State = initState();
let sessionId: string | null = null;
let ws: WebSocket | null = null;
let rafScheduled = false;

/** streaming 是 AssistantMessage（pi 借鉴，整条累积态），取首个 text content 渲染。 */
function streamingText(): string {
  const c = state.streaming?.content?.find((b) => b.type === "text");
  return c?.text ?? "";
}

function render() {
  rafScheduled = false;
  stream.innerHTML = "";
  for (const m of state.messages) {
    const div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "user" : "assistant");
    div.innerHTML = marked.parse(m.text) as string;
    stream.appendChild(div);
  }
  if (state.streaming) {
    const div = document.createElement("div");
    div.className = "msg assistant streaming";
    div.innerHTML = marked.parse(streamingText()) as string;
    stream.appendChild(div);
  }
  stream.scrollTop = stream.scrollHeight;
  sendBtn.hidden = state.busy;
  abortBtn.hidden = !state.busy;
  budgetEl.textContent = state.budget ? `token: ${state.budget.total} / headroom ${state.budget.headroom}` : "—";
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
  ws.onopen = () => { if (sessionId) ws!.send(JSON.stringify({ method: "resume", sessionId })); };
  ws.onclose = () => { setTimeout(connect, 1000); };
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !ws || state.busy) return;
  state = { ...state, messages: [...state.messages, { role: "user", text }], busy: true };
  scheduleRender();
  ws.send(JSON.stringify({ method: "prompt", input: text }));
  input.value = "";
});

abortBtn.addEventListener("click", () => ws?.send(JSON.stringify({ method: "abort" })));
connect();
