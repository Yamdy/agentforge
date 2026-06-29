import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createJsonlSession, rebuildMessages } from "@agentforge/harness";
import { buildHarness, defaultSessionDir } from "@agentforge/cli/repl";
import { serializeWebEvent, parseClientMessage } from "./ws-protocol.js";

/**
 * parseArgs 等价的极简 argv 解析（仅取 startUiServer 实际使用的字段：
 * provider/model/session/resume）。@agentforge/cli 的 parseArgs 位于
 * print-mode.ts 且未从包根 re-export（受 Task 6 文件约束，不改 cli 包），
 * 故在此内联等价实现。与 cli parseArgs 语义一致：--provider/--model/--session/--resume。
 */
function parseServerArgs(argv: string[]): {
  print: boolean;
  rpc: boolean;
  provider: string;
  model: string;
  session?: string;
  resume?: string;
} {
  const out: { provider?: string; model?: string; session?: string; resume?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider") out.provider = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--session") out.session = argv[++i];
    else if (a === "--resume") out.resume = argv[++i];
  }
  return {
    print: false,
    rpc: false,
    provider: out.provider ?? "xiaomi-token-plan-cn",
    model: out.model ?? "mimo-v2.5-pro",
    session: out.session,
    resume: out.resume,
  };
}

export interface UiServerDeps {
  getApiKey: (provider: string) => string | undefined | Promise<string | undefined>;
  streamFn?: any;
  sessionDir?: string;
  port?: number;
  host?: string;
  clientDir?: string;
}
export interface UiServer { port: number; sessionId: string; close: () => Promise<void>; }

export async function startUiServer(argv: string[], deps: UiServerDeps): Promise<UiServer> {
  const args = parseServerArgs(argv);
  const sessionDir = deps.sessionDir ?? defaultSessionDir();
  const sessionId = args.session ?? args.resume ?? randomUUID();
  const session = createJsonlSession(`${sessionDir}/${sessionId}.jsonl`);

  let initialMessages: ReturnType<typeof rebuildMessages> = [];
  if (args.resume) {
    const leafId = session.getLeafId();
    if (!leafId) throw new Error(`--resume ${args.resume}: no existing session`);
    initialMessages = rebuildMessages(session.getPathToRoot(leafId));
  }

  let harness = buildHarness({ args, session, initialMessages, streamFn: deps.streamFn, getApiKey: deps.getApiKey });

  let conn: WebSocket | null = null;
  let busy = false;
  let abortCtl: AbortController | null = null;

  const send = (msg: object) => { if (conn?.readyState === WebSocket.OPEN) conn.send(JSON.stringify(msg)); };

  const subscribe = () => {
    harness.onEvent((e) => {
      const s = serializeWebEvent(e);
      if (s === undefined) return;
      send(s); // server 不批量，每个事件直接转发（pi 借鉴，前端 rAF 合帧）
    });
  };
  subscribe();

  const handlePrompt = async (input: string) => {
    if (busy) { send({ type: "error", message: "busy" }); return; }
    busy = true;
    send({ type: "agent_start" });
    abortCtl = new AbortController();
    try {
      await harness.prompt(input, abortCtl.signal);
      send({ type: "agent_end" });
    } catch (err) {
      send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = false;
      abortCtl = null;
    }
  };

  const handleResume = async (sid: string) => {
    if (busy && abortCtl) abortCtl.abort();
    const newSession = createJsonlSession(`${sessionDir}/${sid}.jsonl`);
    const leafId = newSession.getLeafId();
    if (!leafId) { send({ type: "error", message: `resume: no session ${sid}` }); return; }
    const msgs = rebuildMessages(newSession.getPathToRoot(leafId));
    harness = buildHarness({ args, session: newSession, initialMessages: msgs, streamFn: deps.streamFn, getApiKey: deps.getApiKey });
    subscribe();
    send({ type: "resumed", sessionId: sid });
  };

  const clientDir = deps.clientDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "client");
  const httpServer = http.createServer((req, res) => {
    const map: Record<string, [string, string]> = {
      "/": ["index.html", "text/html"],
      "/index.html": ["index.html", "text/html"],
      "/bundle.js": ["bundle.js", "text/javascript"],
      "/style.css": ["style.css", "text/css"],
    };
    const entry = map[req.url ?? ""];
    if (!entry) { res.writeHead(404); res.end("not found"); return; }
    readFile(path.join(clientDir, entry[0]))
      .then((body) => { res.writeHead(200, { "content-type": entry[1] }); res.end(body); })
      .catch(() => { res.writeHead(404); res.end("not found"); });
  });

  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws) => {
    conn = ws;
    ws.on("message", (data) => {
      const msg = parseClientMessage(data.toString());
      if (!msg.ok) { send({ type: "error", message: msg.error }); return; }
      if (msg.method === "prompt") void handlePrompt(msg.input);
      else if (msg.method === "abort") abortCtl?.abort();
      else if (msg.method === "resume") void handleResume(msg.sessionId);
    });
    ws.on("close", () => { conn = null; });
  });

  await new Promise<void>((resolve) => httpServer.listen(deps.port ?? 0, deps.host ?? "127.0.0.1", resolve));
  const port = (httpServer.address() as { port: number }).port;

  return {
    port,
    sessionId,
    close: async () => { wss.close(); await new Promise<void>((r) => httpServer.close(() => r())); },
  };
}
