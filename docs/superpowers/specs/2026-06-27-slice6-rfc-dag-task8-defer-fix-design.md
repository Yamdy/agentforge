# Slice 6 RFC-DAG Task 8 defer 修复设计（v3,红队+实测修订）

**Date:** 2026-06-27
**Branch:** pi（唯一,无 remote,本地未 push,遵 AGENTS.md）
**背景:** Slice 6 RFC-DAG Task 8 真对话自举 merge 链路未验证。原 handoff 归因 ①（council 测试 fail）阻塞 merge。**红队 Oracle 审查 + 实测发现真阻塞是 worktree 无 node_modules**（非 ①）,进一步实测发现 worktree gate 还需 build dist。本 v3 spec 修订归因 + 修法。复用已有 spec/plan（`2026-06-27-slice6-rfc-dag`）,不另起 plan。

## 红队发现（归因修订）

### 真阻塞:worktree 无 node_modules + dist（实测确认）
- `gate.ts:29` `DEFAULT_COMMANDS = ["pnpm -r typecheck", "pnpm -r test"]`,gate 在 worktree cwd 跑（`rfc-dag-runner.ts:147` `gateFactory(wt)`）
- `worktree-pool.ts:28` `addWorktree` 仅 `git worktree add --force`,**无 pnpm install/build**
- 实测:创建临时 worktree,node_modules 完全不存在;gate 第一个命令 `pnpm -r typecheck` 在第一个包 `shared` 就失败（`Cannot find module '@earendil-works/pi-agent-core'` + pnpm 警告 `node_modules missing`）
- 进一步实测:即使 `pnpm install` 装了 node_modules,typecheck 仍 fail `Cannot find module '@agentforge/shared'`——worktree 无 `packages/shared/dist`（gitignore）,tsc 走 dist types condition
- **gate 在 typecheck 阶段就 fail,根本跑不到 test → council 测试从未被执行 → ① 不是阻塞**
- continuous-PR 不受影响:`loop-mode.ts:103` gate cwd = 主 repo（不用 worktree,主 repo 有 node_modules + dist）→ pass

### 其他发现（已验证）
- ① "rebuild harness dist" 是 no-op:`harness/tsconfig.json:8` exclude `*.test.ts`,① 改测试不改产品,dist 不变
- ②③ prompt 约束只证明字符串追加,不证明 LLM 遵守;③ silent-success 不被 prompt 机器关闭（本次纯 prompt,真对话验证后按需加 gate post-check）
- force-track council 比 tmpdir fixture 简单（`.gitignore:10` `.agentforge/` 整体 ignore,force-track + exception 可行）

## 修法（3 决策,用户拍板）

### 🆕 worktree install+build（blocking,优先 — Q1）

**问题:** worktree gate 跑 `pnpm -r typecheck` / `pnpm -r test` 需 node_modules + workspace 包 dist,worktree 均无 → gate typecheck 阶段 fail,merge 链路跑不起来。

**修法:**
- `WorktreeOps` 接口加 `installDeps(path: string): Promise<void>`
- `DryRunWorktreeOps` 实现:`pnpm install`（装 node_modules）+ `pnpm -r build`（建 workspace 包 dist——tsc 走 dist types condition,worktree 无 `packages/*/dist`（gitignore）→ typecheck 会因找不到 `@agentforge/*` 失败）
- `runUnit` 在 `addWorktree` 后、agent run 前调 `this.deps.worktreeOps.installDeps(wt)`

**设计点:**
- pnpm 全局 store + 硬链接,主 repo 已 install → worktree install 几秒;build 重建各包 dist（continuous-PR 主 repo 有 dist 不受影响）
- 每 unit 一次 install+build（worktree 隔离要求各 worktree 独立 deps+dist）
- install/build 失败 best-effort non-fatal（catch 不 throw）:install 是"准备"让 gate 能跑,gate 才是"验证"。失败（无 package.json/lockfile 等）不阻塞——生产 gate 会因缺依赖/dist 失败驱动 retry,wiring 测试 gate（`node -e exit(0)`）不受影响

### ① council force-track（Q2,Oracle 推荐）

**问题:** worktree install+build 修通后 gate 能跑到 test,council 测试（`skills.test.ts:221-256`）读 `<repoRoot>/.agentforge/skills/council`（gitignored）→ worktree 无 → `expect(council).toBeDefined()` fail。

**修法:**
- `.gitignore` 逐级 exception:`.agentforge/*` / `!.agentforge/skills/` / `.agentforge/skills/*` / `!.agentforge/skills/council/`（git 规则:父目录 exclude 时子 exception 不生效,须逐级）
- `git add` council SKILL.md（exception 让不需 -f）
- council 进 track → worktree checkout 有它 → council 测试在 worktree pass

**落点:** `.gitignore`（逐级 exception）+ `git add` council SKILL.md。**skills.test.ts 零改动**,保留原覆盖。

**关键:须 commit 到 baseBranch（HEAD）。** worktree 从 HEAD checkout,council 只 staged 未 commit → worktree 无 council → 测试 fail。force-track 须 commit（本 spec step 4）才让 worktree checkout 含 council。

### ②③ buildPrompt 约束（Q3 纯 prompt hardening）

**问题:** `buildPrompt`（`rfc-dag-runner.ts:219-235`）"要求"段仅"完成本 unit scope。完成后输出 DONE。",无文件边界/测试约定 → agent 越界改 docs（②）、新建非 `*.test.ts`（③ silent-success）。

**修法:** "要求"段后加"边界约束"段:

```
--- 边界约束（必须遵守）---
- 只修改本 unit scope 相关的源文件;不要修改 docs/、ADR、README 或任何与本 unit 无关的文件。
- 所有新增测试必须加到现有的 *.test.ts 文件中;不要新建测试文件。
```

`buildPrompt` 保持 private。

**TDD:** `agentRunner.run` mock 捕获 `mock.calls[0][0]`（prompt）,断言含"不要修改" + docs/ADR/README（②）、`*.test.ts` + "不要新建"（③）。RED（当前无约束）→ GREEN。rebuild cli dist。

**限制（诚实）:** prompt 约束不保证 LLM 遵守,③ silent-success 不被 prompt 机器关闭。真对话验证后若 agent 真违规,再加 gate post-check（`git diff --name-only` 拒绝非 `*.test.ts` 新文件,~5 行）。

## TDD 顺序 + 验证

1. **worktree install+build**（blocking）:`WorktreeOps.installDeps`（install+build）+ `runUnit` 调用,TDD mock 验证 → rebuild cli dist
2. **① force-track**:`.gitignore` 逐级 exception + `git add` council SKILL.md
3. **②③ buildPrompt 约束**:RED→GREEN → rebuild cli dist
4. **commit**（force-track 须 commit 才让 worktree 有 council）:worktree install+build + ① force-track + ②③ + spec,commit 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`
5. **真对话验证**（Plan Task 8 命令,MiMo `.env` `XIAOMI_TOKEN_PLAN_CN_API_KEY`,commit 后 worktree 有 council）:worktree install+build 后 gate 跑到 test → council pass（force-track）→ merge 链路跑通（gate pass → merge → final verify）
6. **全量回归** 529 绿（+worktree install+②③ 测试）+ 4 包 typecheck

## 范围

- 改代码:`packages/cli/src/rfc-dag/worktree-pool.ts`（`installDeps`:install+build）+ `packages/cli/src/rfc-dag/rfc-dag-runner.ts`（`runUnit` 调用 + `buildPrompt` 约束）+ `.gitignore`（逐级 exception）
- git 操作:`git add` council SKILL.md + commit
- `skills.test.ts`:零改动（force-track 后 worktree 有 council）
- harness/shared/eval/loop 零改动
- 不写新 plan（复用 `2026-06-27-slice6-rfc-dag.md` Task 8）
