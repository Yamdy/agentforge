# 问题 A 修复设计：rfc-dag worktree 隔离（tools cwd 传递）

- **Date**: 2026-06-28
- **Branch**: pi（HEAD=1c1240c，本地未 push，无 remote）
- **范围**: A+B 同批修（问题 A=tools cwd 传递；问题 B=env-config.test 隔离 process.env）。问题 C（worktree EBUSY）不修。
- **上游 handoff**: `%TEMP%\agentforge-problem-a-fix-handoff.md`
- **相关 spec**: `docs/superpowers/specs/2026-06-27-slice6-rfc-dag-task8-defer-fix-design.md`（Slice 6 / Task 8 defer 修复）

## 1. 背景

Task 8 真对话验证发现 rfc-dag **0/4 unit merged**（stop=final-verify-failed）。agent 产出（serializeEntries）改在了**主 repo** 而非 worktree：worktree 的 index.ts 无改动，`rfc-dag/T1` 分支 log 无 agent commit。worktree 隔离完全失效。

Task 8 的 3 个 defer 修复（worktree install+build / council force-track / buildPrompt 约束）均已验证通过，与本问题无关。本问题是 tools 层的独立缺陷。

## 2. 根因（已读源码确认）

数据流（unit 执行阶段）：

1. `packages/cli/src/rfc-dag/rfc-dag-runner.ts:140` `wt = ${worktreesDir}/${unit.id}`（worktree 路径）
2. `rfc-dag-runner.ts:158` `await this.deps.agentRunner.run(prompt, { cwd: wt, signal })` —— **正确**传 worktree cwd ✓
3. `packages/cli/src/loop/agent-runner.ts:71` `cwd: runOpts.cwd ?? this.opts.cwd` —— 把 `wt` 传给 `AgentForgeHarness({ cwd: wt })` ✓
4. `packages/harness/src/harness.ts:158` `this.cwd = opts.cwd ?? process.cwd()` —— 接收 `wt` ✓
5. `harness.ts:264-268` 只把 `this.cwd` 传给 `safetyCtx`（`SafetyContext.cwd`），**不传给 tools** ✗
6. `agent-runner.ts:64` `tools: this.opts.tools` —— 用 runner 构造时固定的 tools（无 cwd 绑定）✗
7. `rfc-dag-mode.ts:104` `createLoopAgentDeps()` 无参构造 → `rfc-dag-mode.ts:105-113` `new InProcessAgentRunner({ tools, ... })` —— tools 在此固定为主 repo 语义 ✗

6 个 tool 全基于 `process.cwd()`（主 repo，rfc-dag 命令启动目录）：

| tool | file:line | cwd 来源 |
|---|---|---|
| bash | `tools/bash.ts:38-41` | `execAsync(command, { timeout, maxBuffer })` 不传 cwd → 继承 `process.cwd()` |
| glob | `tools/glob.ts:117` | `const baseDir = path ?? process.cwd()` |
| grep | `tools/grep.ts:71-73` | `execAsync(cmd, { maxBuffer })` 不传 cwd → 继承 `process.cwd()` |
| edit | `tools/edit.ts:36,61` | `readFile(path)` / `writeFile(path)` 用 agent 提供的 path，不解析相对路径 |
| write | `tools/write.ts` | 同 edit |
| read | `tools/read.ts` | 同 edit |

**结论**：harness 的 `cwd=worktree` 对 tools 完全无效。agent 通过 glob/grep/bash 在主 repo 探索 → 拿到主 repo 路径 → 用 edit/write 改主 repo → worktree 无产出 → `wtGitOps.commit` 时 worktree `hasChanges=false` → commit 无效 → 0/4 merged。

## 3. 方案选择

pi-agent-core `AgentTool.execute` 签名（`node_modules/.../pi-agent-core/dist/types.d.ts:333`）：

```ts
execute: (toolCallId: string, params: Static<TParameters>, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<TDetails>) => Promise<AgentToolResult<TDetails>>;
```

**无 context 参数，无 cwd**。`AgentContext` / `BeforeToolCallContext` / `AfterToolCallContext` 也都不含 cwd。pi-agent-core 的 `ExecutionEnv`/`FileSystem`/`Shell` 抽象有 cwd，但那是另一套独立抽象（session 存储/高层执行环境），与 `AgentTool.execute` 无关，agentforge CLI tools 走直接 `node:fs`/`node:child_process`，不用这套。

- **方案 1（解构 context.cwd）**：❌ 不可行——execute 无 context 参数。
- **方案 3（harness prompt 前 `process.chdir(cwd)`）**：❌ 不推荐——全局影响，in-process 并发不安全，违反 fresh context 隔离原则。
- **方案 2a（tools 构造时绑定 cwd）**：✅ 选定。

## 4. 修复设计（方案 2a）

### 4.1 6 个 tool 接收可选 `cwd`（默认 `process.cwd()`，兼容现有无参调用）

每个 `createXxxTool(cwd?: string)` 接收 cwd，默认回退 `process.cwd()`，使 REPL/print-mode 等现有无参调用行为不变。

- **bash** (`tools/bash.ts`): `execAsync(command, { cwd: cwd ?? undefined, timeout: timeoutMs, maxBuffer })`。cwd 为 undefined 时 exec 用进程 cwd（与现状一致）。
- **glob** (`tools/glob.ts:117`): `const baseDir = path ?? cwd`（cwd 默认 `process.cwd()`，保持原 fallback 语义）。
- **grep** (`tools/grep.ts:71-73`): `execAsync(cmd.join(" "), { cwd: cwd ?? undefined, maxBuffer })`。rg 在 cwd 下搜索；`path` 参数仍可显式覆盖搜索范围。
- **edit** (`tools/edit.ts`): `import { isAbsolute, resolve } from "node:path"`；`const resolved = isAbsolute(path) ? path : resolve(cwd, path)`；readFile/writeFile 用 `resolved`。schema 描述从"要编辑的文件绝对路径"改为"要编辑的文件路径（相对路径基于 cwd 解析）"。
- **write** (`tools/write.ts`): 同 edit（isAbsolute/resolve）。
- **read** (`tools/read.ts`): 同 edit（isAbsolute/resolve）。

**为何 edit/write/read 也要 cwd**：修复后 glob/grep/bash 在 worktree 探索 → 返回 worktree 相对路径 → agent 拿相对路径调 edit/write/read。若这三个不解析相对路径，agent 传的相对路径会被 readFile 当成相对 `process.cwd()`（主 repo）解析 → 仍改主 repo。故必须 `resolve(cwd, path)`。

### 4.2 `createLoopAgentDeps(cwd?: string)` 透传 cwd

`packages/cli/src/loop/agent-deps.ts`:

```ts
export function createLoopAgentDeps(cwd?: string): LoopAgentDeps {
    return {
        tools: [
            createReadTool(cwd),
            createBashTool(cwd),
            createEditTool(cwd),
            createWriteTool(cwd),
            createGrepTool(cwd),
            createGlobTool(cwd),
        ],
        systemPrompt: createSystemPromptWithSkills(DEFAULT_SYSTEM_PROMPT, defaultSkillDirs()),
        safety: createSafetyGuard(),
    };
}
```

无参调用（loop-mode `index.ts:55`）行为不变（各 tool cwd=undefined → 回退 `process.cwd()`）。

### 4.3 toolsFactory 注入（核心）—— 让 tools 随 per-run cwd 重建

当前 `InProcessAgentRunner` 构造时固定 `tools: any[]`（`agent-runner.ts:45,64`），run 时不重建。需让 tools 按 per-run 的 `runOpts.cwd` 重建。

`packages/cli/src/loop/agent-runner.ts`:

- `InProcessAgentRunnerOptions` 加 `toolsFactory?: (cwd: string) => any[]`，保留 `tools?: any[]` 兼容现有调用。
- `run()`:
  ```ts
  const runCwd = runOpts.cwd;   // AgentRunOptions.cwd 必填 string(agent-runner.ts:33)
  const tools = this.resolveTools(runCwd);
  const harness = new AgentForgeHarness({ ..., tools, cwd: runCwd, ... });
  ```
- 为可测性，提取私有方法 `private resolveTools(cwd: string): any[]`：
  ```ts
  return this.opts.toolsFactory ? this.opts.toolsFactory(cwd) : this.opts.tools;
  ```
  （`run` 调用它；单测通过 `(runner as any).resolveTools(cwd)` 访问。）

`packages/cli/src/rfc-dag/rfc-dag-mode.ts:104-113` 改为：

```ts
const { systemPrompt, safety } = createLoopAgentDeps();   // tools 改由工厂按 per-run cwd 重建
const agentRunner = new InProcessAgentRunner({
    provider, model, getApiKey: opts.getApiKey,
    toolsFactory: (cwd: string) => createLoopAgentDeps(cwd).tools,
    systemPrompt, safety, streamFn: opts.streamFn,
});
```

- **rfc-dag unit 执行**（`rfc-dag-runner.ts:158` 传 `cwd: wt`）→ `toolsFactory(wt)` → worktree tools ✓
- **decompose 阶段**（`dag-decomposer.ts:96` 传 `cwd: process.cwd()`）→ `toolsFactory(process.cwd())` → 主 repo tools（decompose 不改代码，合理）✓
- **loop-mode / print-mode / repl** 仍用 `tools`（固定，cwd=主 repo 正确），不受影响 ✓

### 4.4 问题 B 同批修：env-config.test.ts 隔离 process.env

`packages/cli/src/env-config.test.ts` 的 "returns undefined when no env key set" 用例：`afterEach` 只 `vi.unstubAllEnvs`（清 stub），不清真实 env。`source .env` 后 `process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY` 有真值 → 测试 expected undefined 收到真 key → fail → `pnpm -r test` fail → gate（`pnpm -r typecheck && pnpm -r test`）永失败 → unit 无法 merge。

修：beforeEach `delete process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY`（或测试内 `vi.stubAllEnvs({})` 显式确保 key 缺失）。**不修则 A 修了 merge 链路仍断**。

### 4.5 问题 C 不修

`worktree-pool.ts:52-58` removeWorktree 已 best-effort catch EBUSY（Windows node_modules 锁）。retry 时 `git worktree add` 报 already-exists 是非阻塞稳定性问题，不影响 merge 正确性。本批不修，留待后续 Windows 稳定性专项。

## 5. TDD 策略

### 5.1 RED 单测（6 tool cwd 行为，核心可测层）

- **bash**: `createBashTool(tmpDir)` 跑 `node -e "process.stdout.write(process.cwd())"`，断言输出 === tmpDir（跨平台，不依赖 shell 内建 `pwd`/`cd`）。
- **glob**: 在 tmpDir 建文件 `a.ts`，`createGlobTool(tmpDir)` 搜 `*.ts`，断言返回含 `a.ts` 且不含主 repo 文件。
- **grep**: 在 tmpDir 建文件含 `markerXYZ`，`createGrepTool(tmpDir)` 搜 `markerXYZ`，断言命中 tmpDir 文件。
- **edit**: 在 tmpDir 建文件 `f.ts`，`createEditTool(tmpDir)` 用**相对路径** `f.ts` 替换，断言 tmpDir/f.ts 被改、主 repo 无同名文件被改。
- **write**: 类似 edit，相对路径写入 tmpDir。
- **read**: 在 tmpDir 建文件，`createReadTool(tmpDir)` 用相对路径读，断言读到 tmpDir 内容。
- **默认 cwd 兼容**: `createBashTool()` 无参仍正常（回退 process.cwd()）。

### 5.2 toolsFactory 注入单测

`InProcessAgentRunner.resolveTools(cwd)`: 构造 runner 传 `toolsFactory`，断言 `resolveTools(wt)` 返回 `toolsFactory(wt)` 的产物；构造 runner 传 `tools`（无 factory），断言 `resolveTools(any)` 返回 `this.opts.tools`。

### 5.3 集成/端到端

不写 mock LLM 的端到端（InProcessAgentRunner.run 内部 new AgentForgeHarness，mock 成本高、价值低）。靠**真对话验证**（§6）端到端确认 agent 改 worktree 不改主 repo。

## 6. 验证计划

1. `pnpm -r typecheck`（4 包绿，LSP `AssistantMessage` 等诊断是缓存误报，以 typecheck 为准）。
2. `pnpm -r test`（含新 RED→GREEN 单测 + 问题 B 修复后 env-config.test 绿）。
3. `pnpm -r build`（rebuild dist，cli bin 跑 dist，改 tools/harness 后必须 rebuild 才生效）。
4. **真对话验证**（修正命令）:
   ```bash
   set -a; source .env; set +a
   node packages/cli/dist/index.js rfc-dag --rfc .agentforge/rfc.md --base-branch pi --max-runs 5 --provider xiaomi-token-plan-cn --model mimo-v2.5-pro
   ```
   - rfc.md 放 `.agentforge/`（untracked 不污染 runner `isClean` 断言）。
   - 内容：简单任务（shared 包加 `serializeEntries` 函数 + 测试，易过 gate）。
   - 成功标准：gate pass → unit merged → final-verify PASS（**非 0/4 merged**）。验证 agent 产出在 worktree（grep worktree index.ts 有 serializeEntries）而非主 repo。

## 7. 安全 / 回滚

- `DryRunGitOps` 名「DryRun」实指「不 push/不开 PR」，**本地 git 操作全真执行**（checkout/commit/merge/tag/branch -D）。`merge --no-edit` 会真改 pi 分支。
- `rfc-dag-runner.ts:78` decompose 前打 tag `rfc-dag-rollback-{timestamp}`（指向当前 HEAD=1c1240c），结束输出 `git reset --hard <tag>`。
- pi 有未 push 重要 commit（1c1240c 等），验证后**必须回滚**：`git reset --hard rfc-dag-rollback-*` + 清 `rfc-dag/*` 分支 + rollback tag + worktree + state。
- 跑前确认：pi HEAD=1c1240c + 工作区 CLEAN + typecheck 基线绿。

## 8. 不做（YAGNI）

- 不改 harness 通用包（`@agentforge/harness`）——cwd 传递是 cli/loop 层职责，harness 不该知道 loop 语义。
- 不改 pi-agent-core（外部依赖，且 execute 无 context 是其设计）。
- 不修问题 C（EBUSY，非阻塞）。
- 不为 loop-mode/print-mode/repl 加 toolsFactory（它们 cwd=主 repo 正确，固定 tools 即可）。
- 不写 mock LLM 端到端测试（靠真对话验证）。
