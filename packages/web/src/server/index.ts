import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createJsonlSession, rebuildMessages } from "@agentforge/harness";
import { buildHarness, defaultSessionDir } from "@agentforge/cli/repl";
import { parseArgs, type ParsedArgs } from "@agentforge/cli/print-mode";
import {
	loadProviderConfig,
	resolveProvider,
	maskApiKey,
	type ProviderConfig,
} from "@agentforge/cli/provider-config";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { serializeWebEvent, parseClientMessage } from "./ws-protocol.js";

export interface UiServerDeps {
  getApiKey: (provider: string) => string | undefined | Promise<string | undefined>;
  streamFn?: any;
  sessionDir?: string;
  port?: number;
  host?: string;
  clientDir?: string;
  /** 覆盖 provider 配置目录（默认 ~/.agentforge）。测试注入临时目录。 */
  configDir?: string;
  /** 直接注入 ProviderConfig（优先于 configDir 读盘）。传 null 模拟无配置。 */
  providerConfig?: ProviderConfig | null;
}
export interface UiServer { port: number; sessionId: string; close: () => Promise<void>; }

export async function startUiServer(argv: string[], deps: UiServerDeps): Promise<UiServer> {
  const args = parseArgs(argv);
  const sessionDir = deps.sessionDir ?? defaultSessionDir();
  let sessionId = args.session ?? args.resume ?? randomUUID();
  const session = createJsonlSession(`${sessionDir}/${sessionId}.jsonl`);

  let initialMessages: AgentMessage[] = [];
  if (args.resume) {
    const leafId = session.getLeafId();
    if (!leafId) throw new Error(`--resume ${args.resume}: no existing session`);
    initialMessages = rebuildMessages(session.getPathToRoot(leafId));
  }

  // provider 配置（option 2，per-provider key+model）。借鉴 pi auth.json：config > env。
  // 优先级：--provider/--model 显式 flag > config.default/entry > parseArgs 默认（DEFAULT_PROVIDER/MODEL）。
  // argv.includes 区分显式 flag 与 parseArgs 默认值（parseArgs 给了 default，无法从 args 本身区分）。
  const config = deps.providerConfig !== undefined ? deps.providerConfig : loadProviderConfig({ configDir: deps.configDir });
  const explicitProvider = argv.includes("--provider") ? args.provider : undefined;
  const explicitModel = argv.includes("--model") ? args.model : undefined;
  const resolved = config ? resolveProvider(config, explicitProvider ?? config.default) : undefined;
  let activeProvider = resolved?.provider ?? args.provider;
  let activeModel = explicitModel ?? resolved?.model ?? args.model;
  let activeApiKey: string | undefined = resolved?.apiKey;
  let activeArgs: ParsedArgs = { ...args, provider: activeProvider, model: activeModel };
  // getApiKey 闭包读 activeApiKey（let，切换时更新）：config 优先，回退 deps.getApiKey（env）。
  const getApiKey = (provider: string): string | undefined | Promise<string | undefined> =>
    activeApiKey ?? deps.getApiKey(provider);

  let harness = buildHarness({ args: activeArgs, session, initialMessages, streamFn: deps.streamFn, getApiKey });

  let conn: WebSocket | null = null;
  let busy = false;
  let abortCtl: AbortController | null = null;

  const send = (msg: object) => { if (conn?.readyState === WebSocket.OPEN) conn.send(JSON.stringify(msg)); };

  /** 当前 providers 快照（apiKey 脱敏）+ active。无 config → 空列表（前端隐藏 select）。 */
  const providersSnapshot = () => ({
    type: "providers" as const,
    providers: config
      ? Object.entries(config.providers).map(([provider, e]) => ({
          provider, model: e.model, apiKey: maskApiKey(e.apiKey),
        }))
      : [],
    ...(activeProvider !== undefined ? { active: activeProvider } : {}),
  });

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
    abortCtl = new AbortController();
    try {
      // agent_start / agent_end 由 harness 经 subscribe 转发（pi 生命周期事件），server 不再合成
      await harness.prompt(input, abortCtl.signal);
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
    // 复用 activeArgs（保留当前 provider/model/getApiKey），只换 session + 历史 messages。
    harness = buildHarness({ args: activeArgs, session: newSession, initialMessages: msgs, streamFn: deps.streamFn, getApiKey });
    sessionId = sid; // 修 bug：更新 server sessionId 变量（get_state 依赖）
    subscribe();
    send({ type: "resumed", sessionId: sid });
  };

  const handleGetState = (id?: string) => {
    send({
      type: "state",
      ...(id !== undefined ? { id } : {}),
      sessionId,
      isStreaming: busy,
      isCompacting: false, // agentforge 同步压缩无可观测窗口（spec §2.3）
      messageCount: harness.messages.length,
      pendingMessageCount: 0, // P1 无消息队列（spec §2.3）
    });
  };

  /** 切换 active provider：更新 activeArgs/apiKey，重建 harness（保留对话 messages），推 providers 快照。
   *  busy 时拒（与 handlePrompt 一致）；无 config 或未知 provider 发 error。 */
  const handleSetProvider = (provider: string) => {
    if (busy) { send({ type: "error", message: "busy" }); return; }
    if (!config) { send({ type: "error", message: "no provider config" }); return; }
    const r = resolveProvider(config, provider);
    if (!r) { send({ type: "error", message: `unknown provider: ${provider}` }); return; }
    activeProvider = r.provider;
    activeModel = r.model;
    activeApiKey = r.apiKey;
    activeArgs = { ...activeArgs, provider: activeProvider, model: activeModel };
    // 重建 harness：initialMessages 取当前 harness.messages，保留对话历史（同对话换 provider 继续）。
    harness = buildHarness({ args: activeArgs, session, initialMessages: harness.messages, streamFn: deps.streamFn, getApiKey });
    subscribe();
    send(providersSnapshot());
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
      else if (msg.method === "get_state") handleGetState(msg.id);
      else if (msg.method === "list_providers") send(providersSnapshot());
      else if (msg.method === "set_provider") handleSetProvider(msg.provider);
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
