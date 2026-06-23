/**
 * cli 层 compaction 配置构造（Slice 2.5）。集中构造 harness 的 4 个 compaction/budget
 * 字段，供 buildHarness（repl/rpc）与 runPrintMode（print）共用。见 spec §3.2。
 */
import { getModel, completeSimple } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createCompactor, DEFAULT_THRESHOLDS } from "@agentforge/harness";
import type { CompactDeps } from "@agentforge/harness";

/** generateSummary 的 systemPrompt（草案；质量留待 Slice 4 instinct / 人工评估）。 */
export const SUMMARIZE_PROMPT =
  "Summarize the preceding conversation history concisely for context retention. " +
  "Preserve: key decisions and their rationale, files read/written/edited (with paths), " +
  "important errors encountered and resolutions, and any unfinished tasks. " +
  "Omit verbatim tool-call arguments and large file contents. Output only the summary prose.";

/**
 * 构造 generateSummary：用 completeSimple 非流式取摘要，honor signal，await 异步 getApiKey。
 */
function createSummaryGenerator(
  model: ReturnType<typeof getModel>,
  getApiKey: (provider: string) => string | undefined | Promise<string | undefined>,
  provider: string,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<string> {
  return async (messages, signal?) => {
    const apiKey = await getApiKey(provider);
    // AgentMessage[]（pi-agent-core 超集，含 UI-only 角色）→ pi-ai Message[]。
    // compaction 摘要输入为对话历史（LLM-compatible），此处做边界 cast，
    // 与 pi-agent-core convertToLlm 在 LLM 调用前的转换同义。
    const assistant = await completeSimple(
      model,
      { systemPrompt: SUMMARIZE_PROMPT, messages: messages as unknown as Message[] },
      { apiKey, signal },
    );
    const textBlock = (assistant.content as any[]).find((b) => b?.type === "text");
    return textBlock?.text ?? "";
  };
}

/** createCompactionConfig 入参。 */
export interface CreateCompactionConfigOpts {
  provider: string;
  model: string;
  getApiKey: (provider: string) => string | undefined | Promise<string | undefined>;
  stageMarkers?: string[];
}

/** 构造 harness compaction/budget 四字段。 */
export function createCompactionConfig(opts: CreateCompactionConfigOpts): {
  compactor: ReturnType<typeof createCompactor>;
  compactorDeps: CompactDeps;
  modelContextWindow: number;
  budgetThresholds: typeof DEFAULT_THRESHOLDS;
} {
  const model = getModel(opts.provider as any, opts.model as any);
  const generateSummary = createSummaryGenerator(model, opts.getApiKey, opts.provider);
  const compactorDeps: CompactDeps = { generateSummary };
  return {
    compactor: createCompactor({ stageMarkers: opts.stageMarkers ?? [] }),
    compactorDeps,
    modelContextWindow: model.contextWindow,
    budgetThresholds: DEFAULT_THRESHOLDS,
  };
}
