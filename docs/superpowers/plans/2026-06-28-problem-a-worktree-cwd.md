# 问题 A 修复实施计划：rfc-dag worktree 隔离（tools cwd 传递）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 rfc-dag 的 agent tools 使用 harness 的 worktree cwd（而非 `process.cwd()` 主 repo），使 agent 在 worktree 改代码、commit 生效、unit 能 merge。

**Architecture:** 方案 2a——6 个 tool 构造时绑定可选 `cwd`（默认 `process.cwd()` 兼容）；`createLoopAgentDeps(cwd)` 透传；`InProcessAgentRunner` 加 `toolsFactory` 注入，per-run 按 `runOpts.cwd` 重建 tools；rfc-dag-mode 用 `toolsFactory`。问题 B（env-config.test 隔离）同批修。

**Tech Stack:** TypeScript, pnpm monorepo, vitest, pi-agent-core (`AgentTool.execute` 无 context 参数).

**Spec:** `docs/superpowers/specs/2026-06-28-problem-a-worktree-cwd-design.md`

## Global Constraints

- pnpm monorepo（4 包）。单文件测试：`pnpm --filter @agentforge/cli exec vitest run <test-file>`；全量：`pnpm -r typecheck && pnpm -r test`。
- 改 tools/harness/runner 后**必须** `pnpm -r build` rebuild dist（cli bin 跑 dist，老 dist 不生效）。
- 红队 #6：cwd 默认**必须在 tool 构造器内** `const c = cwd ?? process.cwd()`，**不能**把 `undefined` 传给 `path.resolve`（会 throw `TypeError`）。
- 红队 #1 不变量：`toolCwd === harness.cwd` 必须始终成立（`run()` 中 `resolveTools(runCwd)` 与 `cwd: runCwd` 同源）。
- commit 末尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`。pi 分支无 remote，**不 push**。
- GateGuard：本 session 首次 bash 须陈述事实；destructive（`reset --hard`/`branch -D`/`tag -d`/worktree remove）须陈述 3 事实。
- LSP 报的 `AssistantMessage` 等诊断是**缓存误报**，以 `pnpm -r typecheck` 为准。

## File Structure

- Modify: `packages/cli/src/tools/bash.ts` — `createBashTool(cwd?)`, execAsync 传 cwd
- Modify: `packages/cli/src/tools/glob.ts` — `createGlobTool(cwd?)`, baseDir 用 cwd
- Modify: `packages/cli/src/tools/grep.ts` — `createGrepTool(cwd?)`, execAsync 传 cwd
- Modify: `packages/cli/src/tools/edit.ts` — `createEditTool(cwd?)`, isAbsolute/resolve
- Modify: `packages/cli/src/tools/write.ts` — `createWriteTool(cwd?)`, isAbsolute/resolve
- Modify: `packages/cli/src/tools/read.ts` — `createReadTool(cwd?)`, isAbsolute/resolve
- Modify: `packages/cli/src/loop/agent-deps.ts` — `createLoopAgentDeps(cwd?)` 透传
- Modify: `packages/cli/src/loop/agent-runner.ts` — `toolsFactory` + `resolveTools`
- Modify: `packages/cli/src/rfc-dag/rfc-dag-mode.ts` — 用 toolsFactory
- Modify: `packages/cli/src/env-config.test.ts` — 问题 B 隔离 process.env
- Test（已存在，追加用例）: `packages/cli/src/tools/{bash,glob,grep,edit,write,read}.test.ts`, `packages/cli/src/loop/agent-runner.test.ts`, `packages/cli/src/loop/agent-deps.test.ts`

---

## Task 1: bash tool 接收 cwd

**Files:**
- Modify: `packages/cli/src/tools/bash.ts:27`（`createBashTool` 签名 + execute 的 execAsync）
- Test: `packages/cli/src/tools/bash.test.ts`

**Interfaces:**
- Produces: `createBashTool(cwd?: string): AgentTool<...>`。cwd 默认 `process.cwd()`。

- [ ] **Step 1: 写失败测试**

追加到 `packages/cli/src/tools/bash.test.ts`（文件顶部 import 段已 `import { describe, it, expect } from "vitest"` + `import { createBashTool } from "./bash.js"`，补充 fs/path import）：

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// ...existing imports...

  it("executes in the provided cwd (worktree isolation)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "bash-cwd-"));
    const tool = createBashTool(tmp);
    const result = await tool.execute("call-cwd", {
      command: 'node -e "process.stdout.write(process.cwd())"',
    });
    expect((result.content[0] as { text: string }).text).toBe(tmp);
  });

  it("no-arg defaults to process.cwd() (backward compat)", async () => {
    const tool = createBashTool();
    const result = await tool.execute("call-default", {
      command: 'node -e "process.stdout.write(process.cwd())"',
    });
    expect((result.content[0] as { text: string }).text).toBe(process.cwd());
  });
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm --filter @agentforge/cli exec vitest run src/tools/bash.test.ts`
Expected: FAIL — `createBashTool` 不接收参数（TS 报错或运行时忽略 cwd，输出 === process.cwd() 而非 tmp）。

- [ ] **Step 3: 实现**

修改 `packages/cli/src/tools/bash.ts`：

```ts
export function createBashTool(cwd?: string): AgentTool<typeof bashSchema, BashToolDetails> {
  const c = cwd ?? process.cwd();
  return {
    name: "bash",
    label: "Bash",
    description: "执行 shell 命令，返回 stdout 与 stderr。非零退出码视为失败。",
    parameters: bashSchema,
    async execute(_toolCallId, { command, timeout }) {
      const startedAt = Date.now();
      const timeoutMs = timeout && timeout > 0 ? timeout : undefined;

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: c,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        });
        const durationMs = Date.now() - startedAt;
        const text = (stdout + (stderr ? stderr : "")).trimEnd();
        return {
          content: [{ type: "text", text }],
          details: { command, exitCode: 0, durationMs },
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - startedAt;
        const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
        const stdout = e.stdout ?? "";
        const stderr = e.stderr ?? "";
        const combined = (stdout + (stderr ? stderr : "")).trimEnd();
        const exitCode = typeof e.code === "number" ? e.code : null;
        const detail: BashToolDetails = { command, exitCode, durationMs };
        const msg = combined ? `${combined}\n\nCommand exited with code ${exitCode}` : `Command exited with code ${exitCode}`;
        const error = new Error(msg) as Error & { details?: BashToolDetails };
        error.details = detail;
        throw error;
      }
    },
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm --filter @agentforge/cli exec vitest run src/tools/bash.test.ts`
Expected: PASS（全部用例含新增 2 个）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/tools/bash.ts packages/cli/src/tools/bash.test.ts
git commit -m "$(cat <<'EOF'
fix(tools): bash tool 接收 cwd(execAsync 传 cwd,默认 process.cwd())

问题 A 修复 Task 1:rfc-dag worktree 隔离需 tools 用 worktree cwd 而非
process.cwd()。createBashTool(cwd?) 构造器内 c=cwd??process.cwd(),execAsync
传 cwd:c。无参兼容。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: glob tool 接收 cwd

**Files:**
- Modify: `packages/cli/src/tools/glob.ts:110`（`createGlobTool` 签名）+ `:117`（baseDir）
- Test: `packages/cli/src/tools/glob.test.ts`

**Interfaces:**
- Produces: `createGlobTool(cwd?: string)`。`baseDir = path ?? c`，`c = cwd ?? process.cwd()`。

- [ ] **Step 1: 写失败测试**

追加到 `packages/cli/src/tools/glob.test.ts`（顶部补 import）：

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// ...

  it("searches in the provided cwd", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "glob-cwd-"));
    writeFileSync(join(tmp, "a.ts"), "x");
    const tool = createGlobTool(tmp);
    const result = await tool.execute("call-cwd", { pattern: "*.ts" });
    expect((result.content[0] as { text: string }).text).toContain("a.ts");
  });
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm --filter @agentforge/cli exec vitest run src/tools/glob.test.ts`
Expected: FAIL（`createGlobTool` 不接收参数；搜索走 `process.cwd()` 不含 tmp 的 a.ts）。

- [ ] **Step 3: 实现**

修改 `packages/cli/src/tools/glob.ts`（`createGlobTool` 签名 + execute 内 baseDir）：

```ts
export function createGlobTool(cwd?: string): AgentTool<typeof globSchema, GlobToolDetails> {
  const c = cwd ?? process.cwd();
  return {
    name: "glob",
    label: "Glob",
    description: "按 glob 模式匹配文件路径（支持 ** * ? {a,b}）。返回相对 baseDir 的路径列表。",
    parameters: globSchema,
    async execute(_toolCallId, { pattern, path }) {
      const baseDir = path ?? c;
      const all = collectFiles(baseDir);
      const rx = globToRegExp(pattern);
      const matched = all.filter((p) => rx.test(p)).sort();
      const truncated = matched.length > MAX_FILES;
      const files = truncated ? matched.slice(0, MAX_FILES) : matched;
      const text = files.join("\n");
      return {
        content: [{ type: "text", text }],
        details: { count: files.length, truncated: truncated ? true : undefined },
      };
    },
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm --filter @agentforge/cli exec vitest run src/tools/glob.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/tools/glob.ts packages/cli/src/tools/glob.test.ts
git commit -m "$(cat <<'EOF'
fix(tools): glob tool 接收 cwd(baseDir 用 cwd,默认 process.cwd())

问题 A 修复 Task 2:createGlobTool(cwd?) 构造器内 c=cwd??process.cwd(),
baseDir=path??c。无参兼容。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: grep tool 接收 cwd

**Files:**
- Modify: `packages/cli/src/tools/grep.ts:44`（签名）+ `:71`（execAsync）
- Test: `packages/cli/src/tools/grep.test.ts`

**Interfaces:**
- Produces: `createGrepTool(cwd?: string)`。execAsync 传 `cwd: c`。

- [ ] **Step 1: 写失败测试**

追加到 `packages/cli/src/tools/grep.test.ts`（顶部补 import；注意 rg 须在 PATH，Windows 需自装 ripgrep——见 grep.ts 注释。若 CI 无 rg，此用例可 skip）：

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// ...

  it("searches in the provided cwd", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "grep-cwd-"));
    writeFileSync(join(tmp, "f.ts"), "markerXYZ");
    const tool = createGrepTool(tmp);
    const result = await tool.execute("call-cwd", { pattern: "markerXYZ" });
    expect((result.content[0] as { text: string }).text).toContain("f.ts");
  });
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm --filter @agentforge/cli exec vitest run src/tools/grep.test.ts`
Expected: FAIL（无 cwd 参数；rg 在 `process.cwd()` 搜索，不含 tmp/f.ts）。若环境无 rg，测试 throw "ripgrep not installed"——先确认 rg 可用（`rg --version`），否则 skip 本 task 测试但仍改实现（靠 typecheck + 其他 task 间接覆盖）。

- [ ] **Step 3: 实现**

修改 `packages/cli/src/tools/grep.ts`（签名 + execute 内 execAsync）：

```ts
export function createGrepTool(cwd?: string): AgentTool<typeof grepSchema, GrepToolDetails> {
  const c = cwd ?? process.cwd();
  return {
    name: "grep",
    label: "Grep",
    description: "基于 ripgrep 的正则搜索。无匹配返回空（rg 退出码 1 非错误）。",
    parameters: grepSchema,
    async execute(_toolCallId, params) {
      const { pattern, path, glob, output_mode } = params;

      const cmd: string[] = ["rg", pattern];

      if (output_mode === "files_with_matches") {
        cmd.push("--files-with-matches");
      } else if (output_mode === "count") {
        cmd.push("--count");
      }

      if (params["-n"]) cmd.push("-n");
      if (params["-i"]) cmd.push("-i");
      if (params["-C"] !== undefined) {
        cmd.push("-C", String(params["-C"]));
      }
      if (glob) cmd.push("--glob", glob);
      if (path) cmd.push(path);

      try {
        const { stdout } = await execAsync(cmd.join(" "), {
          cwd: c,
          maxBuffer: 10 * 1024 * 1024,
        });
        return {
          content: [{ type: "text", text: stdout.trimEnd() }],
          details: { exitCode: 0 },
        };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
        const code = typeof e.code === "number" ? e.code : undefined;
        const stderr = e.stderr ?? "";
        const stdout = e.stdout ?? "";

        if (code === 1) {
          return { content: [{ type: "text", text: "" }], details: { exitCode: 1 } };
        }
        if (code === undefined && (/not found/i.test(stderr) || /not found/i.test(e.message ?? ""))) {
          throw new Error("ripgrep (rg) not installed");
        }
        const combined = (stdout + (stderr ? stderr : "")).trimEnd();
        const msg = combined ? `${combined}\n\nrg exited with code ${code}` : `rg exited with code ${code}`;
        throw new Error(msg);
      }
    },
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm --filter @agentforge/cli exec vitest run src/tools/grep.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/tools/grep.ts packages/cli/src/tools/grep.test.ts
git commit -m "$(cat <<'EOF'
fix(tools): grep tool 接收 cwd(execAsync 传 cwd,默认 process.cwd())

问题 A 修复 Task 3:createGrepTool(cwd?) 构造器内 c=cwd??process.cwd(),
execAsync 传 cwd:c。无参兼容。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: edit/write/read 接收 cwd（路径解析类）

**Files:**
- Modify: `packages/cli/src/tools/edit.ts:28`（签名 + execute resolve）+ `:7`（schema 描述）
- Modify: `packages/cli/src/tools/write.ts:26`（签名 + execute resolve）+ `:9`（schema 描述）
- Modify: `packages/cli/src/tools/read.ts:25`（签名 + execute resolve）+ `:7`（schema 描述）
- Test: `packages/cli/src/tools/{edit,write,read}.test.ts`

**Interfaces:**
- Produces: `createEditTool(cwd?)`/`createWriteTool(cwd?)`/`createReadTool(cwd?)`。构造器内 `const c = cwd ?? process.cwd()`；execute 内 `const resolved = isAbsolute(path) ? path : resolve(c, path)`；readFile/writeFile/mkdir 用 `resolved`；details.path 用 `resolved`。schema path 描述改"文件路径（相对路径基于 cwd 解析）"。
- 红队 #6：`c = cwd ?? process.cwd()` **必须**在构造器内，`resolve` 收到字符串。

- [ ] **Step 1: 写失败测试（edit 代表性 + 无参回归 + 绝对路径 by design）**

追加到 `packages/cli/src/tools/edit.test.ts`（顶部补 import）：

```ts
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// ...

  it("resolves relative path against cwd (worktree isolation)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "edit-rel-"));
    writeFileSync(join(tmp, "f.ts"), "old");
    const tool = createEditTool(tmp);
    await tool.execute("call-rel", { path: "f.ts", old_string: "old", new_string: "new" });
    expect(readFileSync(join(tmp, "f.ts"), "utf-8")).toBe("new");
  });

  it("uses absolute path as-is (isAbsolute short-circuit, by design)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "edit-abs-"));
    const abs = join(tmp, "f.ts");
    writeFileSync(abs, "old");
    const tool = createEditTool(tmp);
    await tool.execute("call-abs", { path: abs, old_string: "old", new_string: "new" });
    expect(readFileSync(abs, "utf-8")).toBe("new");
  });

  it("no-arg does not throw TypeError on relative path (red-team #6 regression)", async () => {
    const tool = createEditTool();
    // 无参 → c=process.cwd()。相对路径 resolve(process.cwd(), path) 不 throw;
    // 文件不存在 → readFile ENOENT(非 TypeError)。
    await expect(
      tool.execute("call-noarg", { path: "nonexistent-xyz.xyz", old_string: "x", new_string: "y" }),
    ).rejects.toThrow(/ENOENT/);
  });
```

write/read 测试同构（write: 相对路径写入 tmp + 无参不 throw；read: 相对路径读 tmp + 无参 ENOENT）。示例（write.test.ts）：

```ts
  it("resolves relative path against cwd", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "write-rel-"));
    const tool = createWriteTool(tmp);
    await tool.execute("call-rel", { path: "f.ts", content: "hi" });
    expect(readFileSync(join(tmp, "f.ts"), "utf-8")).toBe("hi");
  });

  it("no-arg does not throw TypeError on relative path (red-team #6)", async () => {
    const tool = createWriteTool();
    const tmp = mkdtempSync(join(tmpdir(), "write-noarg-"));
    await tool.execute("call-noarg", { path: join(tmp, "f.ts"), content: "x" }); // 绝对路径,无参不 throw
    expect(readFileSync(join(tmp, "f.ts"), "utf-8")).toBe("x");
  });
```

read.test.ts：

```ts
  it("resolves relative path against cwd", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "read-rel-"));
    writeFileSync(join(tmp, "f.ts"), "hello");
    const tool = createReadTool(tmp);
    const result = await tool.execute("call-rel", { path: "f.ts" });
    expect((result.content[0] as { text: string }).text).toBe("hello");
  });
```

- [ ] **Step 2: 先跑现有测试确认基线**

Run: `pnpm --filter @agentforge/cli exec vitest run src/tools/edit.test.ts src/tools/write.test.ts src/tools/read.test.ts`
Expected: 现有用例 PASS（基线绿），新增用例 FAIL（无 cwd 参数 / 相对路径未解析）。

- [ ] **Step 3: 实现 edit.ts**

修改 `packages/cli/src/tools/edit.ts`：

```ts
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

const editSchema = Type.Object({
  path: Type.String({ description: "要编辑的文件路径（相对路径基于 cwd 解析）" }),
  old_string: Type.String({ description: "要替换的精确文本（必须唯一，除非 replace_all）" }),
  new_string: Type.String({ description: "替换后的文本" }),
  replace_all: Type.Optional(Type.Boolean({ description: "替换所有出现，默认 false" })),
});

export type EditToolInput = Static<typeof editSchema>;

export interface EditToolDetails {
  path: string;
  replacements: number;
}

export function createEditTool(cwd?: string): AgentTool<typeof editSchema, EditToolDetails> {
  const c = cwd ?? process.cwd();
  return {
    name: "edit",
    label: "Edit",
    description: "精确字符串替换编辑文件。old_string 默认必须唯一，replace_all=true 时全部替换。",
    parameters: editSchema,
    async execute(_toolCallId, { path, old_string, new_string, replace_all }) {
      const resolved = isAbsolute(path) ? path : resolve(c, path);
      const content = await readFile(resolved, "utf-8");

      const occurrences = content.split(old_string).length - 1;

      let newContent: string;
      let replacements: number;

      if (replace_all === true) {
        if (occurrences === 0) {
          throw new Error(`old_string not found in ${resolved}`);
        }
        newContent = content.split(old_string).join(new_string);
        replacements = occurrences;
      } else {
        if (occurrences !== 1) {
          throw new Error(`old_string must be unique in file (found ${occurrences} occurrences)`);
        }
        newContent = content.replace(old_string, new_string);
        replacements = 1;
      }

      await writeFile(resolved, newContent, "utf-8");

      return {
        content: [
          { type: "text", text: `Edited ${resolved} (${replacements} replacement${replacements === 1 ? "" : "s"})` },
        ],
        details: { path: resolved, replacements },
      };
    },
  };
}
```

- [ ] **Step 4: 实现 write.ts**

修改 `packages/cli/src/tools/write.ts`：

```ts
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

const writeSchema = Type.Object({
  path: Type.String({ description: "要写入的文件路径（相对路径基于 cwd 解析）" }),
  content: Type.String({ description: "文件内容" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

export interface WriteToolDetails {
  path: string;
  bytes: number;
  created: boolean;
}

export function createWriteTool(cwd?: string): AgentTool<typeof writeSchema, WriteToolDetails> {
  const c = cwd ?? process.cwd();
  return {
    name: "write",
    label: "Write",
    description: "写入文件内容。父目录不存在自动创建；文件已存在则覆盖。",
    parameters: writeSchema,
    async execute(_toolCallId, { path, content }) {
      const resolved = isAbsolute(path) ? path : resolve(c, path);
      const created = !existsSync(resolved);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
      return {
        content: [{ type: "text", text: `Wrote ${content.length} bytes to ${resolved}` }],
        details: { path: resolved, bytes: content.length, created },
      };
    },
  };
}
```

- [ ] **Step 5: 实现 read.ts**

修改 `packages/cli/src/tools/read.ts`（execute 内 `const resolved = isAbsolute(path) ? path : resolve(c, path)`，readFile 用 resolved，details.path 用 resolved）。顶部 import 加 `isAbsolute, resolve`：

```ts
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

const readSchema = Type.Object({
  path: Type.String({ description: "要读取的文件路径（相对路径基于 cwd 解析）" }),
  offset: Type.Optional(Type.Number({ description: "起始行(1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "最多行数" })),
});

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
  path: string;
  size: number;
  truncation?: { reason: "offset" | "limit"; shownLines: number; totalLines: number };
}

export function createReadTool(cwd?: string): AgentTool<typeof readSchema, ReadToolDetails> {
  const c = cwd ?? process.cwd();
  return {
    name: "read",
    label: "Read",
    description: "读取文件内容。支持 offset（1-indexed 起始行）与 limit（最多行数）切片。",
    parameters: readSchema,
    async execute(_toolCallId, { path, offset, limit }) {
      const resolved = isAbsolute(path) ? path : resolve(c, path);
      const buffer = await readFile(resolved);
      const text = buffer.toString("utf-8");
      const allLines = text.split("\n");
      const trimmed = allLines[allLines.length - 1] === "" ? allLines.slice(0, -1) : allLines;
      const totalLines = trimmed.length;

      const startLine = offset ? Math.max(0, offset - 1) : 0;
      if (startLine >= trimmed.length && trimmed.length > 0) {
        throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines total)`);
      }
      if (trimmed.length === 0 && startLine > 0) {
        throw new Error(`Offset ${offset} is beyond end of file (0 lines total)`);
      }

      let selected: string[];
      let truncation: ReadToolDetails["truncation"] | undefined;
      if (limit !== undefined) {
        const endLine = Math.min(startLine + limit, trimmed.length);
        selected = trimmed.slice(startLine, endLine);
        if (endLine < trimmed.length) {
          truncation = { reason: "limit", shownLines: selected.length, totalLines };
        }
      } else {
        selected = trimmed.slice(startLine);
        if (startLine > 0) {
          truncation = { reason: "offset", shownLines: selected.length, totalLines };
        }
      }

      const outputText = selected.join("\n");
      return {
        content: [{ type: "text", text: outputText }],
        details: { path: resolved, size: text.length, truncation },
      };
    },
  };
}
```

- [ ] **Step 6: 跑测试验证通过**

Run: `pnpm --filter @agentforge/cli exec vitest run src/tools/edit.test.ts src/tools/write.test.ts src/tools/read.test.ts`
Expected: PASS（现有 + 新增）。注意：现有 edit/write/read 测试若用绝对路径，`isAbsolute` 直用不破；若有用相对路径的旧用例，行为变化（现解析到 process.cwd()，等价于原 Node readFile 行为）—— 若有旧用例 fail，检查其路径假设。

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/tools/edit.ts packages/cli/src/tools/write.ts packages/cli/src/tools/read.ts packages/cli/src/tools/edit.test.ts packages/cli/src/tools/write.test.ts packages/cli/src/tools/read.test.ts
git commit -m "$(cat <<'EOF'
fix(tools): edit/write/read 接收 cwd(isAbsolute/resolve,默认 process.cwd())

问题 A 修复 Task 4:路径解析类 tool 构造器内 c=cwd??process.cwd(),
resolved=isAbsolute(path)?path:resolve(c,path)。红队 #6:cwd 默认必须在
构造器内(防 resolve(undefined) throw)。schema 描述改"相对路径基于 cwd 解析"。
红队 #2:绝对路径直用(isAbsolute 短路)是 by design,containment 靠 worktree
探索路径机制。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: createLoopAgentDeps(cwd) 透传

**Files:**
- Modify: `packages/cli/src/loop/agent-deps.ts:29`（签名 + 各 createXxxTool(cwd)）
- Test: `packages/cli/src/loop/agent-deps.test.ts`

**Interfaces:**
- Consumes: Task 1-4 的 `createXxxTool(cwd?)`。
- Produces: `createLoopAgentDeps(cwd?: string): LoopAgentDeps`。无参仍兼容（各 tool cwd=undefined → process.cwd()）。

- [ ] **Step 1: 写失败测试**

追加到 `packages/cli/src/loop/agent-deps.test.ts`（顶部补 import）：

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// ...

  it("passes cwd through to tools (worktree isolation)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "deps-cwd-"));
    const deps = createLoopAgentDeps(tmp);
    const bash = deps.tools.find((t) => t.name === "bash");
    expect(bash).toBeDefined();
    const result = await bash!.execute("c", {
      command: 'node -e "process.stdout.write(process.cwd())"',
    });
    expect((result.content[0] as { text: string }).text).toBe(tmp);
  });
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm --filter @agentforge/cli exec vitest run src/loop/agent-deps.test.ts`
Expected: FAIL（`createLoopAgentDeps` 不接收参数；bash tool 用 process.cwd()，输出 !== tmp）。

- [ ] **Step 3: 实现**

修改 `packages/cli/src/loop/agent-deps.ts`：

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
        systemPrompt: createSystemPromptWithSkills(
            DEFAULT_SYSTEM_PROMPT,
            defaultSkillDirs(),
        ),
        safety: createSafetyGuard(),
    };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm --filter @agentforge/cli exec vitest run src/loop/agent-deps.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/loop/agent-deps.ts packages/cli/src/loop/agent-deps.test.ts
git commit -m "$(cat <<'EOF'
fix(loop): createLoopAgentDeps(cwd) 透传 cwd 给各 tool

问题 A 修复 Task 5:createLoopAgentDeps(cwd?) 把 cwd 传给 6 个 createXxxTool。
无参兼容(loop-mode index.ts:55)。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: InProcessAgentRunner toolsFactory + resolveTools

**Files:**
- Modify: `packages/cli/src/loop/agent-runner.ts:41-50`（options 加 toolsFactory）+ `:52-91`（run 用 resolveTools + 私有方法）
- Test: `packages/cli/src/loop/agent-runner.test.ts`

**Interfaces:**
- Consumes: 无（runner 独立）。
- Produces: `InProcessAgentRunnerOptions.toolsFactory?: (cwd: string) => any[]`（保留 `tools?: any[]`）；私有 `resolveTools(cwd: string): any[]`。`run()` 用 `resolveTools(runOpts.cwd)` + `cwd: runOpts.cwd`（红队 #1 同源不变量）。

- [ ] **Step 1: 写失败测试**

追加到 `packages/cli/src/loop/agent-runner.test.ts`（顶部 import 加 `vi`：`import { describe, it, expect, vi } from "vitest"`）：

```ts
	it("resolveTools uses toolsFactory(cwd) when provided", () => {
		let receivedCwd: string | undefined;
		const mockTool = { name: "mock", label: "M", description: "", parameters: undefined as any, execute: vi.fn() };
		const runner = new InProcessAgentRunner({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			getApiKey: () => "k",
			toolsFactory: (cwd: string) => {
				receivedCwd = cwd;
				return [mockTool];
			},
			systemPrompt: "",
		});
		const tools = (runner as unknown as { resolveTools(cwd: string): unknown[] }).resolveTools("/worktree/T1");
		expect(receivedCwd).toBe("/worktree/T1");
		expect(tools).toContain(mockTool);
	});

	it("resolveTools falls back to opts.tools when no factory", () => {
		const mockTool = { name: "mock" } as any;
		const runner = new InProcessAgentRunner({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			getApiKey: () => "k",
			tools: [mockTool],
			systemPrompt: "",
		});
		const tools = (runner as unknown as { resolveTools(cwd: string): unknown[] }).resolveTools("/any");
		expect(tools).toEqual([mockTool]);
	});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm --filter @agentforge/cli exec vitest run src/loop/agent-runner.test.ts`
Expected: FAIL（`toolsFactory` 不在 options 类型；`resolveTools` 不存在）。

- [ ] **Step 3: 实现**

修改 `packages/cli/src/loop/agent-runner.ts`：

options 接口加 `toolsFactory`（保留 `tools`）：

```ts
export interface InProcessAgentRunnerOptions {
	provider: string;
	model: string;
	getApiKey?: (provider: string) => string | Promise<string | undefined>;
	tools?: any[];
	toolsFactory?: (cwd: string) => any[];
	systemPrompt: string;
	streamFn?: any;
	safety?: any;
	cwd?: string;
}
```

类加 `resolveTools` + `run` 改用它：

```ts
export class InProcessAgentRunner implements AgentRunner {
	private readonly opts: InProcessAgentRunnerOptions;

	constructor(opts: InProcessAgentRunnerOptions) {
		this.opts = opts;
	}

	/** 按 per-run cwd 解析 tools:有 toolsFactory 则重建(绑定 cwd),否则用固定 tools。
	 *  红队 #1:调用方须保证 toolsFactory(cwd) 的 cwd === 传给 harness 的 cwd(runCwd)。 */
	private resolveTools(cwd: string): any[] {
		return this.opts.toolsFactory ? this.opts.toolsFactory(cwd) : this.opts.tools;
	}

	async run(prompt: string, runOpts: AgentRunOptions): Promise<AgentRunResult> {
		const runCwd = runOpts.cwd;
		const tools = this.resolveTools(runCwd);
		// fresh harness per run(D13:不注入 instinct/auditor/verifier/compactor)。
		const harness = new AgentForgeHarness({
			session: createMemorySession(),
			events: createEventBus(),
			tools,
			provider: this.opts.provider,
			model: this.opts.model,
			systemPrompt: this.opts.systemPrompt,
			getApiKey: this.opts.getApiKey,
			streamFn: this.opts.streamFn,
			safety: this.opts.safety,
			cwd: runCwd,
			initialMessages: [],
		});

		await harness.prompt(prompt, runOpts.signal);

		const messages = harness.agent.state.messages;
		const assistants = messages.filter(isAssistantMessage);
		const cost = assistants.reduce((sum, m) => sum + (m.usage?.cost?.total ?? 0), 0);
		const tokensIn = assistants.reduce((sum, m) => sum + (m.usage?.input ?? 0), 0);
		const tokensOut = assistants.reduce((sum, m) => sum + (m.usage?.output ?? 0), 0);
		const last = assistants[assistants.length - 1];
		const reply = last ? contentToText(last.content) : "";
		return { reply, cost, tokensIn, tokensOut };
	}
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm --filter @agentforge/cli exec vitest run src/loop/agent-runner.test.ts`
Expected: PASS（含新增 2 个 + 现有 run/fresh-context 用例——现有用例传 `tools: []`，resolveTools 无 factory 回退 `this.opts.tools` = `[]`，不破）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/loop/agent-runner.ts packages/cli/src/loop/agent-runner.test.ts
git commit -m "$(cat <<'EOF'
fix(loop): InProcessAgentRunner 加 toolsFactory(per-run 按 cwd 重建 tools)

问题 A 修复 Task 6:options 加 toolsFactory?:(cwd)=>any[](保留 tools 兼容);
run 用 resolveTools(runCwd) 重建 tools + cwd:runCwd(红队 #1 同源不变量)。
loop-mode/print-mode/repl 仍用固定 tools(cwd=主 repo 正确),不受影响。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: rfc-dag-mode 用 toolsFactory（wiring）

**Files:**
- Modify: `packages/cli/src/rfc-dag/rfc-dag-mode.ts:104-113`（createLoopAgentDeps 拆分 + InProcessAgentRunner 用 toolsFactory）

**Interfaces:**
- Consumes: Task 5 `createLoopAgentDeps(cwd?)` + Task 6 `toolsFactory`。
- Produces: rfc-dag 的 agentRunner 用 `toolsFactory: (cwd) => createLoopAgentDeps(cwd).tools`，per-unit-run 按 worktree cwd 重建 tools。

**注：** wiring task，无新行为单测（机械改造）。验证靠 typecheck + 现有 `rfc-dag-mode.test.ts` 不破 + Task 6 resolveTools 测试 + 真对话验证（§6）。

- [ ] **Step 1: 跑现有 rfc-dag-mode 测试确认基线**

Run: `pnpm --filter @agentforge/cli exec vitest run src/rfc-dag/rfc-dag-mode.test.ts`
Expected: PASS（基线绿）。

- [ ] **Step 2: 实现**

修改 `packages/cli/src/rfc-dag/rfc-dag-mode.ts:104-113`：

```ts
	// tools 改由 toolsFactory 按 per-run cwd 重建(rfc-dag unit 执行传 cwd=worktree →
	// worktree tools;decompose 传 cwd=process.cwd() → 主 repo tools)。systemPrompt/safety 不依赖 cwd。
	const { systemPrompt, safety } = createLoopAgentDeps();
	const agentRunner = new InProcessAgentRunner({
		provider,
		model,
		getApiKey: opts.getApiKey,
		toolsFactory: (cwd: string) => createLoopAgentDeps(cwd).tools,
		systemPrompt,
		safety,
		streamFn: opts.streamFn,
	});
```

- [ ] **Step 3: typecheck + 跑现有测试确认不破**

Run: `pnpm --filter @agentforge/cli exec tsc --noEmit -p tsconfig.json`（或 `pnpm -r typecheck`）
Expected: 无新增 type error（LSP `AssistantMessage` 等是缓存误报，以 tsc 为准）。

Run: `pnpm --filter @agentforge/cli exec vitest run src/rfc-dag/rfc-dag-mode.test.ts`
Expected: PASS（现有用例 mock agentRunner，不触及 toolsFactory 真路径，不破）。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/rfc-dag/rfc-dag-mode.ts
git commit -m "$(cat <<'EOF'
fix(rfc-dag): rfc-dag-mode 用 toolsFactory 按 worktree cwd 重建 tools

问题 A 修复 Task 7:wiring。agentRunner 用 toolsFactory:(cwd)=>createLoopAgentDeps(cwd).tools,
unit 执行(rfc-dag-runner.ts:158 传 cwd=wt)→ worktree tools;decompose(dag-decomposer.ts:96
传 cwd=process.cwd())→ 主 repo tools。修前 tools 固定主 repo → agent 改主 repo → 0/4 merged。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 问题 B — env-config.test 隔离 process.env

**Files:**
- Modify: `packages/cli/src/env-config.test.ts`（beforeAll 模拟 source .env + beforeEach delete 隔离）

**Interfaces:** 无（测试基础设施修复）。

- [ ] **Step 1: 写失败测试（复现 source .env 后 gate fail）**

修改 `packages/cli/src/env-config.test.ts`，加 `beforeAll` 模拟 source .env 残留真 key（**先不加 beforeEach delete**，复现 fail）：

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getApiKeyFromEnv } from "./env-config.js";

describe("env-config — getApiKeyFromEnv", () => {
	beforeAll(() => {
		// 模拟 source .env:process.env 残留真 key(复现 gate 在 source .env 后 fail 的场景)。
		process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY = "leaked-real";
	});
	afterAll(() => {
		delete process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY;
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("reads XIAOMI_TOKEN_PLAN_CN_API_KEY for xiaomi-token-plan-cn (含 `-` provider 名按 pi-ai 约定映射，非自拼的 `XIAOMI-TOKEN-PLAN-CN_API_KEY`)", () => {
		vi.stubEnv("XIAOMI_TOKEN_PLAN_CN_API_KEY", "mimo-key");
		expect(getApiKeyFromEnv("xiaomi-token-plan-cn")).toBe("mimo-key");
	});

	it("reads DEEPSEEK_API_KEY for deepseek (回归保护，deepseek 行为不变)", () => {
		vi.stubEnv("DEEPSEEK_API_KEY", "ds-key");
		expect(getApiKeyFromEnv("deepseek")).toBe("ds-key");
	});

	it("returns undefined when no env key set", () => {
		// beforeAll 设了 leaked-real,无 beforeEach delete → getApiKeyFromEnv 返回 leaked-real → fail
		expect(getApiKeyFromEnv("xiaomi-token-plan-cn")).toBeUndefined();
	});
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm --filter @agentforge/cli exec vitest run src/env-config.test.ts`
Expected: "returns undefined when no env key set" FAIL — `expected undefined, received "leaked-real"`（复现问题 B）。

- [ ] **Step 3: 修复（加 beforeEach delete 隔离）**

在 `beforeAll` 后加 `beforeEach`：

```ts
	beforeEach(() => {
		// 问题 B 修复:隔离真实 env。source .env 后 process.env 残留真 key,导致
		// "returns undefined" 用例 fail → pnpm -r test fail → gate 永失败 → unit 无法 merge。
		// 每个 it 前清真实 key(stubEnv 的 stub 仍优先,afterEach unstubAllEnvs 清 stub)。
		delete process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY;
		delete process.env.DEEPSEEK_API_KEY;
	});
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm --filter @agentforge/cli exec vitest run src/env-config.test.ts`
Expected: PASS（beforeEach delete 清掉 beforeAll 的 leaked-real；"returns undefined" 返回 undefined；stubEnv 用例不受影响——stub 优先于真实 env）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/env-config.test.ts
git commit -m "$(cat <<'EOF'
test(env-config): 隔离 process.env(问题 B:source .env 后 gate fail)

问题 B 修复:beforeAll 模拟 source .env 残留真 key + beforeEach delete 隔离。
修前 afterEach 只 unstubAllEnvs(清 stub)不清真实 env → source .env 后
"returns undefined" 收到真 key fail → pnpm -r test fail → gate 永失败 → unit
无法 merge。不修则问题 A 修了 merge 链路仍断。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## 验证阶段（全部 task 完成后）

- [ ] **全量 typecheck + test**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: 4 包全绿（含新 RED→GREEN 用例 + 问题 B 修复）。LSP `AssistantMessage` 等诊断忽略。

- [ ] **rebuild dist**

Run: `pnpm -r build`
Expected: 成功（cli bin 跑 dist，改 tools/runner 后必须 rebuild 才生效）。

- [ ] **真对话验证（spec §6）**

前置：pi HEAD 含 Task 1-8 commit + 1c1240c；工作区 CLEAN；`.agentforge/rfc.md` 就位（简单任务：shared 包加 `serializeEntries` 函数 + 测试）。

Run:
```bash
set -a; source .env; set +a
node packages/cli/dist/index.js rfc-dag --rfc .agentforge/rfc.md --base-branch pi --max-runs 5 --provider xiaomi-token-plan-cn --model mimo-v2.5-pro
```

Expected:
- gate pass → unit merged → final-verify PASS（**非 0/4 merged**）。
- **正向断言**：grep worktree index.ts 有 `serializeEntries`。
- **负向断言（红队 #2 必需）**：grep **主 repo index.ts 无 `serializeEntries`**。worktree 有 + 主 repo 无 = 隔离真生效。

- [ ] **回滚 pi（destructive，陈述 3 事实）**

验证后**必须回滚**（pi 有未 push 重要 commit）：
```bash
git reset --hard rfc-dag-rollback-*   # 指向 1c1240c
git branch -D $(git branch --list 'rfc-dag/*')   # 清 rfc-dag/* 分支
git tag -d rfc-dag-rollback-*   # 清 rollback tag
# 清 worktree + state(.agentforge/worktrees, .agentforge/rfc-dag)
```
更新 memory `agentforge-project-direction.md`。

## Self-Review

**Spec coverage:** spec §4.1（6 tool cwd）→ Task 1-4 ✓；§4.2（createLoopAgentDeps(cwd)）→ Task 5 ✓；§4.3（toolsFactory + resolveTools + 不变量）→ Task 6 ✓；§4.3 rfc-dag-mode wiring → Task 7 ✓；§4.4（问题 B）→ Task 8 ✓；§5 TDD → 每 task RED→GREEN ✓；§6 验证 → 验证阶段 ✓；红队 #6（构造器内默认）→ Task 4 Step 3-5 + Global Constraints ✓；红队 #1（不变量）→ Task 6 注释 + resolveTools(runCwd)/cwd:runCwd 同源 ✓；红队 #2（负向断言）→ 验证阶段 ✓。

**Placeholder scan:** 无 TBD/TODO；每步有完整代码或 exact 命令。

**Type consistency:** `createXxxTool(cwd?: string)` 签名在 Task 1-4 定义、Task 5 消费一致；`toolsFactory?: (cwd: string) => any[]` 在 Task 6 定义、Task 7 消费一致；`resolveTools(cwd: string): any[]` 定义与测试访问一致。
