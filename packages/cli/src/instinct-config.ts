/**
 * cli 层 instinct 配置构造（Slice 4-B T8）。集中构造 harness 的 instinct store，
 * 供 cli 三模式（repl/rpc/print）共用。见 spec §3.2 / plan T8。
 *
 * 三件套：
 * - createExtractRun：用 completeSimple 非流式跑 EXTRACT_PROMPT，解析 `{instincts:[...]}`
 *   为 ExtractedInstinct[]（partial 候选，id/scope/时间戳由 harness extract() 补齐）。
 * - computeProjectHash：env > git remote > git repo path > null 三级回退。
 * - createInstinctConfig：getModel + createExtractRun + computeProjectHash + createInstinctStore。
 */
import { completeSimple, getModel } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createInstinctStore,
  EXTRACT_PROMPT,
  type ExtractRun,
  type ExtractedInstinct,
  type Instinct,
  type Observation,
} from "@agentforge/harness";

/**
 * 格式化 instinct 列表为 /instincts REPL 命令的可读文本（Slice 4-B T9）。
 * 空 → "No instincts learned yet for this project."；非空每行
 * `id | scope | confidence | trigger → action (evidence: N)`。
 */
export function formatInstinctsList(instincts: Instinct[]): string {
  if (instincts.length === 0) {
    return "No instincts learned yet for this project.";
  }
  return instincts
    .map(
      (i) =>
        `${i.id} | ${i.scope} | ${i.confidence} | ${i.trigger} → ${i.action} (evidence: ${i.evidence.length})`,
    )
    .join("\n");
}

export function createExtractRun(
  model: ReturnType<typeof getModel>,
  getApiKey: (provider: string) => string | undefined | Promise<string | undefined>,
  provider: string,
  completeSimpleFn: typeof completeSimple = completeSimple,
): ExtractRun {
  return async (observations: Observation[], signal?: AbortSignal): Promise<ExtractedInstinct[]> => {
    const apiKey = await getApiKey(provider);
    const res = await completeSimpleFn(
      model,
      { systemPrompt: EXTRACT_PROMPT, messages: [{ role: "user", content: JSON.stringify(observations) }] as unknown as Message[] },
      { apiKey, signal },
    );
    const text = (res.content as any[]).find((b) => b?.type === "text")?.text ?? "";
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed.instincts) ? (parsed.instincts as ExtractedInstinct[]) : [];
    } catch {
      return [];
    }
  };
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

export function computeProjectHash(opts?: { execSync?: typeof execSync }): string | null {
  const exec = opts?.execSync ?? execSync;
  if (process.env.AGENTFORGE_PROJECT_DIR) return hash(process.env.AGENTFORGE_PROJECT_DIR);
  try {
    return hash(exec("git remote get-url origin", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim());
  } catch {
    /* no remote */
  }
  try {
    return hash(exec("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim());
  } catch {
    /* not a repo */
  }
  return null;
}

export function createInstinctConfig(opts: {
  provider: string;
  model: string;
  getApiKey: (provider: string) => string | undefined | Promise<string | undefined>;
  dataDir?: string;
}): { instinct: ReturnType<typeof createInstinctStore> } {
  const model = getModel(opts.provider as any, opts.model as any);
  const extractRun = createExtractRun(model, opts.getApiKey, opts.provider);
  const projectHash = computeProjectHash();
  const instinct = createInstinctStore({
    projectHash,
    extractRun,
    dataDir: opts.dataDir,
    modelContextWindow: model.contextWindow,
  });
  return { instinct };
}
