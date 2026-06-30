/**
 * P2-2 pendingTools isError 渲染 — 端到端冒烟 mock server（方案 B）。
 *
 * 直发 WS 事件序列（不经真 LLM/真工具/真 harness），完全控制 isError + 时序，
 * 让 Playwright 在延迟窗口内捕获 pending ⏳ 瞬态 → done ✓ / error ⚠ 终态。
 *
 * 聚焦验证 client main.ts render 接线（P2-2 唯一未真跑环节）：
 *   - message_end(toolCalls) → derivePending 推 pending ⏳
 *   - tool_execution_end(isError:false) → ✓ done + pending 自清
 *   - tool_execution_end(isError:true)  → ⚠ error
 *   - 侧栏 tools: ✓N ⚠M ⏳K 计数
 *
 * server 转发逻辑（serializeWebEvent）由 ws-protocol.test.ts 单测覆盖，本冒烟不重复。
 *
 * 运行：node packages/web/smoke/pending-mock-server.mjs（需先 pnpm --filter @agentforge/web build）
 */
import http from "node:http";
import { WebSocketServer } from "ws";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "client");
const PORT = 18888;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const httpServer = http.createServer((req, res) => {
  const map = {
    "/": ["index.html", "text/html"],
    "/index.html": ["index.html", "text/html"],
    "/bundle.js": ["bundle.js", "text/javascript"],
    "/style.css": ["style.css", "text/css"],
  };
  const entry = map[req.url ?? ""];
  if (!entry) { res.writeHead(404); res.end("not found"); return; }
  readFile(path.join(clientDir, entry[0]))
    .then((b) => { res.writeHead(200, { "content-type": entry[1] }); res.end(b); })
    .catch(() => { res.writeHead(404); res.end("not found"); });
});

const wss = new WebSocketServer({ server: httpServer });
wss.on("connection", (ws) => {
  const send = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  ws.on("message", async (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.method !== "prompt") return;
    // 一次 prompt 两 toolCall：tc-1 → done(✓)，tc-2 → error(⚠)
    const tc1 = { type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "echo a" } };
    const tc2 = { type: "toolCall", id: "tc-2", name: "bash", arguments: { command: "echo b" } };
    const streamingMsg = { role: "assistant", content: [{ type: "text", text: "running tools" }, tc1, tc2] };
    const finalMsg = { role: "assistant", content: [tc1, tc2], stopReason: "toolUse" };
    send({ type: "agent_start" });
    send({ type: "message_update", message: streamingMsg });
    send({ type: "message_end", message: finalMsg });
    await sleep(4000); // pending ⏳×2 窗口（长窗口确保 Playwright MCP 多步开销内可捕获）
    send({ type: "tool_execution_end", toolCallId: "tc-1", toolName: "bash", args: { command: "echo a" }, isError: false });
    await sleep(4000); // ✓ tc-1 + ⏳ tc-2 窗口（长窗口）
    send({ type: "tool_execution_end", toolCallId: "tc-2", toolName: "bash", args: { command: "echo b" }, isError: true });
    send({ type: "agent_end" });
  });
});

await new Promise((r) => httpServer.listen(PORT, "127.0.0.1", r));
console.log(`SMOKE_SERVER_READY port=${PORT}`);
process.on("SIGINT", () => { wss.close(); httpServer.close(); process.exit(0); });
