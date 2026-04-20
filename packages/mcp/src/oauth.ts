import { Effect } from "effect";
import http from "node:http";
import { randomBytes } from "node:crypto";
import open from "open";
import { MCPError } from "./types.js";

/**
 * 简单的 OAuth 回调服务
 */
export class OAuthCallbackServer {
  private static server?: http.Server;
  private static pendingCallbacks: Map<
    string,
    (code: string) => void
  > = new Map();
  private static port?: number;

  /**
   * 确保回调服务正在运行
   */
  static ensureRunning(): Effect.Effect<void, MCPError> {
    if (OAuthCallbackServer.server) return Effect.void;

    return Effect.tryPromise(() => 
      new Promise<void>((resolve) => {
        OAuthCallbackServer.server = http.createServer((req, res) => {
          const url = new URL(req.url || "/", "http://localhost");
          const state = url.searchParams.get("state");
          const code = url.searchParams.get("code");

          if (state && code && OAuthCallbackServer.pendingCallbacks.has(state)) {
            const callback = OAuthCallbackServer.pendingCallbacks.get(state)!;
            callback(code);
            OAuthCallbackServer.pendingCallbacks.delete(state);

            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
              <html>
                <body>
                  <h1>Authentication successful!</h1>
                  <p>You can close this window now.</p>
                </body>
              </html>
            `);
          } else {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`
              <html>
                <body>
                  <h1>Invalid request</h1>
                </body>
              </html>
            `);
          }
        });

        // 监听随机端口
        OAuthCallbackServer.server.listen(0, () => {
          const address = OAuthCallbackServer.server?.address() as any;
          OAuthCallbackServer.port = address.port;
          console.log(`OAuth callback server running on http://localhost:${OAuthCallbackServer.port}`);
          resolve();
        });
      })
    ).pipe(
      Effect.mapError((err) => new MCPError("Failed to start OAuth callback server", err))
    );
  }

  /**
   * 获取回调 URL
   */
  static getRedirectUri(): string {
    if (!OAuthCallbackServer.port) {
      throw new MCPError("OAuth server not running");
    }
    return `http://localhost:${OAuthCallbackServer.port}/callback`;
  }

  /**
   * 等待指定 state 的回调
   * @param state OAuth state
   * @param timeout 超时时间（毫秒）
   */
  static waitForCallback(state: string, timeout = 300000): Effect.Effect<string, MCPError> {
    return Effect.promise(
      () =>
        new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            OAuthCallbackServer.pendingCallbacks.delete(state);
            reject(new MCPError("OAuth timeout"));
          }, timeout);

          OAuthCallbackServer.pendingCallbacks.set(state, (code) => {
            clearTimeout(timer);
            resolve(code);
          });
        })
    ).pipe(
      Effect.mapError((err) => new MCPError("OAuth callback failed", err))
    );
  }

  /**
   * 取消待处理的回调
   * @param state OAuth state
   */
  static cancelPending(state: string): void {
    OAuthCallbackServer.pendingCallbacks.delete(state);
  }
}

/**
 * 生成随机 OAuth state
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString("hex");
}

/**
 * 打开浏览器进行认证
 */
export function openAuthUrl(url: string): Effect.Effect<void, MCPError> {
  return Effect.tryPromise(async () => {
    try {
      await open(url);
      console.log(`Opening browser for authentication: ${url}`);
    } catch (e) {
      console.warn(`Failed to open browser, please open this URL manually: ${url}`);
    }
  }).pipe(
    Effect.mapError((err) => new MCPError("Failed to open browser", err))
  );
}
