/**
 * Slice 7 eval 包类型(spec §4.1)。
 *
 * 设计要点:
 * - acceptanceChecks 声明式(red-team ⚪ 7:避免任意函数,安全 sandbox)
 * - drop retries/avgRetries(red-team 🔴 1:pi 不暴露 retry 计数)
 * - cost 用 usage.cost.total(pi 预算,不重算 Model.cost,避免单位混淆)
 * - pass3 可选(--repeats 3 时填,默认 off,确定性任务测噪声 red-team 🟡 5)
 */
export interface Task {
  id: string;
  prompt: string;
  acceptanceChecks: AcceptanceCheck[];
  /** 限定 harness 允许加载的 tool 名(可选)。 */
  tools?: string[];
  /** 单 task 超时(ms)。 */
  timeout?: number;
  /** setup 在 sandbox 内写文件/准备环境。 */
  setup?: (sandbox: string) => Promise<void>;
  /** teardown 清理 sandbox。 */
  teardown?: (sandbox: string) => Promise<void>;
}

export interface AcceptanceCheck {
  kind: "file-exists" | "file-contains" | "exit-zero";
  /** 相对 sandbox 的路径(file-exists / file-contains)。 */
  path?: string;
  /** file-contains:文件内容须含此子串。 */
  contains?: string;
  /** exit-zero:在 sandbox cwd 跑此 command,退出码 0 即通过。 */
  command?: string;
}

export interface TaskResult {
  taskId: string;
  /** 最后一条 AssistantMessage 的 content text join(harness.prompt 返 void)。 */
  reply: string;
  passed: boolean;
  tokensIn: number;
  tokensOut: number;
  /** usage.cost.total(pi 预算,不重算)。 */
  cost: number;
  wallClockMs: number;
  error?: string;
  // red-team 🔴 1:无 retries(pi 不暴露)
}

export interface EvalConfig {
  name: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  // head-to-head 单变量 diff(见 D5:provider 或 model 或 systemPrompt 之一)
}

export interface SuiteResult {
  config: EvalConfig;
  results: TaskResult[];
  metrics: Metrics;
}

export interface Metrics {
  /** completion rate = passed / total(repeats 聚合后)。 */
  completionRate: number;
  /** 单跑通过率(repeats=1 时同 completionRate)。 */
  pass1: number;
  /** --repeats 3 时填:任一 run 通过率。 */
  pass3?: number;
  totalTokens: number;
  totalCost: number;
  avgWallClockMs: number;
  // drop avgRetries(red-team 🔴 1)
}
