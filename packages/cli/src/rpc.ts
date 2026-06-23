/**
 * cli RPC 模式。见 ARCHITECTURE.md §5 + docs/superpowers/specs/2026-06-23-slice3.5-rpc-design.md。
 *
 * JSONL over stdio（JSON-RPC 2.0）：stdin 读请求，stdout 写响应/事件。
 * runRpcMode 为可测函数（deps 注入），bin 入口 index.ts 调用。
 */
export {};
