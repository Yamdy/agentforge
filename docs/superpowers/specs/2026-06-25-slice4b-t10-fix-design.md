# Slice 4-B 收尾(T10):argsSummary gap + 重复 emit 修复

- **Date**: 2026-06-25
- **Slice**: 4-B 收尾(ARCH §8 Slice 4 instinct 的 T10 真对话验证前置修复)
- **Status**: Design(red-team Oracle 审后修订 v2,待用户 review → plan)
- **依据**: Slice 4-B spec §7.1 controller-known gap(argsSummary undefined + 重复 emit)+ memory T10 DEFER + 收敛验证有效性 gap(error_retry/repeated_workflow 3/3 空)
- **前置**: Slice 4-B T1-T9 完成(318 测试绿,commit `795cfaa`/`314b576`,pi 分支本地未 push)
- **red-team**: Oracle 对抗审查完成,吸收 2 Blocking + 3 Important + 2 Advisory(见 §9 变更记录)

---

## 1. 背景与根因

Slice 4-B T1 探针 gate PASS(非平凡性 + 稳定性收敛,no_signal 不臆造),但收敛验证暴露**有效性 gap**:error_retry(read 失败换路径)+ repeated_workflow(read→edit ×2)两类信号稳定漏提取(3/3 空),尽管 repeated_workflow 的 read→edit 正是 EXTRACT_PROMPT v2 的 Good 例子。T10 真对话验证因此 DEFER。

根因经代码 + 真实 observations + pi 类型定义三方确认(red-team 已逐条复核证据准确):

### 根因 1:argsSummary 永远 undefined
- pi `AfterToolCallContext` 有 `args: unknown`(pi-agent-core `types.d.ts:83`)
- pi 原生 `tool_execution_end` 事件**无 args 字段**(`types.d.ts:392-397`:仅 toolCallId/toolName/result/isError)
- harness afterToolCall emit 时未带 args(`harness.ts:189-195`)→ instinct adapt `e.args`(`instinct.ts:181`)永远 undefined
- 后果:tool_call observation 只有 toolName,丢路径/命令参数 → LLM 无法区分 error_retry(路径变化)与 repeated_workflow(文件关联)→ 漏提取

### 根因 2:tool_execution_end 重复 emit
- pi 原生 `tool_execution_end` 事件(`harness.ts:201` subscribe 全转发)+ harness afterToolCall emit(`harness.ts:189`)= 两个同 toolCallId 事件进 EventBus
- instinct `events.on("*")`(`harness.ts:208`)收到两次 → observe 记双份 tool_call
- **red-team 复核**:今日 ordering(afterToolCall 先于 native)是 pi `agent-loop.js:283-285` 的 `await` 顺序 + EventBus 同步 emit(`events.ts:40`)+ harness handler 同步 三者**组合涌现**,非契约。pi 重构可 silently 破坏。

### 根因 3:历史脏 observations
- `~/.agentforge/projects/1d5220d1e6ba/observations.jsonl` 390 行 = 195 user_message + 195 assistant_message,**0 tool_call**,186 行含 `[object Object]`(red-team 复核计数准确)
- contentToString 修复(`314b576`)前 + 纯对话 session 残留,无 extract 验证价值
- T10 须用修复后代码重跑产生干净 observations

## 2. 范围

**纳入**:
- harness afterToolCall emit 带 args(根因 1 修复)
- instinct observe **prefer-args 去重**(根因 2 修复,见 D2)
- args redaction(bash command secret 处理)
- shared 加 `HarnessToolExecutionEndEvent` typed(消除 as any)
- T10 真对话验证(三类信号 extract 有效性)+ 清理脏 observations
- 更新 memory/ledger

**defer**(Slice 4-B spec §2/§10 已 defer,本次不扩):
- observations.jsonl 轮转/归档、promote/evolve/检索 apply、rpc extract、compaction 禁用开关
- pi 将来若给 native tool_execution_end 加 args 字段 → 两事件都有 args 的双记 edge(当前 pi 类型契约无 args,prefer-args 足够;未来加字段时再补 toolCallId 去重,extract trigger 合并兜底)

## 3. 核心决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | harness afterToolCall emit 加 `args: ctx.args`,事件类型用 shared 新增 `HarnessToolExecutionEndEvent`(带 args) | `ctx` 是 `AfterToolCallContext`(args 字段,types.d.ts:83);typed event 消除 as any(red-team advisory 6);harness emit 用 typed event 而非 pi 原生 tool_execution_end(两者结构不同:typed 带 args) |
| D2 | observe **prefer-args 去重**:跳过 `e.args === undefined` 的 tool_execution_end(= pi 原生无 args 那份),只记录带 args 的(harness 那份) | red-team Blocking 1+2:take-first 依赖未文档化 ordering;prefer-args 直接编码意图("留 harness 带 args 事件"),**不依赖 emit 顺序**,无状态(去掉 ring Set,red-team Important 5 随之解决)。pi 原生事件无 args 字段(types.d.ts:392 类型契约,比 emit 顺序稳定)→ `e.args===undefined` 可靠区分 |
| D3 | 去重在 observe 层(不删 EventBus 事件流) | rpc 转发 tool_execution_end 给 IDE(`rpc.ts` serializeEvent)不受影响;instinct 内部去重 |
| D4 | args redaction:bash/shell 类工具的 command 在 argsSummary 前 redact 常见 secret pattern | red-team Important 4:bash command 含 API_KEY=/Bearer/token,未 redact 持久化 + 喂 extract LLM。200-char cap 会 truncate mid-secret 仍泄露前缀 |
| D5 | T10 验证:三类信号**分三个 scripted `-p` session** 各跑,或单 session 跑至三类都出现(capped N=3 轮) | red-team Advisory 7:LLM 非确定,单 -p 协作产三类不保证;gate 需 retry policy |
| D6 | T10 用 `AGENTFORGE_PROJECT_DIR` 固定 hash + 清理脏 observations | 避免污染真实 instinct 库;脏 observations(1d5220d1e6ba)无验证价值 |

## 4. 组件改动

### 4.1 shared/index.ts 加 HarnessToolExecutionEndEvent

```ts
/** harness afterToolCall emit 的 tool 事件(带 args,区别于 pi 原生 tool_execution_end 无 args)。 */
export interface HarnessToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  args: unknown;       // AfterToolCallContext.args
  result: unknown;
  isError: boolean;
}
```
加入 `HarnessCustomEvent` union(与 pi 原生 tool_execution_end 同 type 名,但带 args——union 中 harness 自定义分支带 args)。harness emit 用此类型(不再 `as any`)。

**注**:pi `AgentEvent` 也有 `tool_execution_end`(无 args),`HarnessEvent = AgentEvent | HarnessCustomEvent` union 会有两个同 type 名分支。TS union 按 type 字段判别时,若两分支同 type 不同字段,需 harness emit 时显式构造带 args 的对象(运行时带 args)。类型层面:emit 端构造 `HarnessToolExecutionEndEvent`,adapt 端读 `e.args`(union 中 harness 分支有 args)。implementer 验 TS union 判别无报错(若 TS 报歧义,adapt 用 `(e as { args?: unknown }).args`)。

### 4.2 harness.ts afterToolCall emit 带 args(typed)

```ts
this.events.emit({
  type: "tool_execution_end",
  toolCallId: ctx.toolCall.id,
  toolName: ctx.toolCall.name,
  args: ctx.args,           // AfterToolCallContext.args
  result: ctx.result,
  isError: ctx.isError,
} satisfies HarnessToolExecutionEndEvent);
```
去掉 `as any`,用 `satisfies` 类型安全。

### 4.3 instinct.ts observe prefer-args 去重 + redact

adapt 的 tool_execution_end 分支:
```ts
if ((event as any).type === "tool_execution_end") {
  const e = event as any;
  // prefer-args 去重:跳过无 args 的事件(pi 原生那份无 args 字段),
  // 只记录带 args 的(harness 那份)。不依赖 emit 顺序,无状态。
  if (e.args === undefined) return [];
  const argsSummary = redactArgs(e.toolName, e.args);  // 见下,D4
  const out: Observation[] = [{ timestamp: ts, projectHash, kind: "tool_call", data: { toolName: e.toolName, argsSummary, isError: e.isError } }];
  if (e.isError) out.push({ timestamp: ts, projectHash, kind: "tool_error", data: { toolName: e.toolName, isError: true } });
  return out;
}
```

**redactArgs(toolName, args)**(D4):序列化 args 前 redact secret:
- `bash`/`shell`/`sh` 类工具:对 `args.command` 字符串 redact 常见 secret pattern(`API_KEY=...`/`TOKEN=...`/`Bearer ...`/`Authorization: ...`/`-H "Authorization: ..."`/`postgres://user:pass@`/`https://<key>@`)→ 替换为 `API_KEY=<redacted>` 等
- 其他工具(read/edit/write 的 path):path 本身不含 secret,不 redact
- redact 后 `truncate(JSON.stringify(args), 200)`
- pattern 列表可扩展,初版覆盖常见 shell secret 形态

**去掉 ring Set**(red-team Important 5):prefer-args 无状态,不需要 toolCallId 记忆。message_end 等其他事件不去重(无重复 emit 问题)。

### 4.4 shared 类型:加 HarnessToolExecutionEndEvent(见 4.1),不改 pi AgentEvent

`AgentEvent` 是 pi 类型(含 tool_execution_end 无 args),不动。harness 自定义事件类型加到 `HarnessCustomEvent`。adapt 读 `e.args` 用 union 中 harness 分支(带 args)。

## 5. T10 真对话验证

1. 清理 `~/.agentforge/projects/1d5220d1e6ba/`(脏 observations)或用新 `AGENTFORGE_PROJECT_DIR` hash 隔离
2. 修复后代码 `pnpm -r build`
3. **三类信号分三个 scripted session**(D5,避免单 -p LLM 非确定):
   - session 1(用户纠正):`-p "用 pnpm -r test 跑测试"` → 若失败,用户 follow-up "不对,用 pnpm --filter @agentforge/harness test"
   - session 2(error_retry):`-p "读 src/index.ts"`(不存在)→ error → follow-up 让 agent 改全路径 `packages/harness/src/index.ts`
   - session 3(repeated_workflow):`-p "读 a.ts 再编辑 a.ts,然后读 b.ts 再编辑 b.ts"`(构造两次 read→edit)
   - 每类若首轮未触发目标信号,capped N=3 轮 retry(换 prompt 措辞)
4. 每个 session end extract → 检查 `instincts/` 产出
5. **gate**:error_retry + repeated_workflow 从「3/3 空」变可提取非平凡 instinct(泛化 trigger/action,非字面重述);用户纠正类保持已验证可提取
6. 重启 session `/instincts` 验 apply(注入 systemPrompt)
7. 临时探针脚本验证后删(仿 T1 习惯,不 commit)
8. Windows 路径:`AGENTFORGE_PROJECT_DIR` 用 `%TEMP%\instinct-t10` 或项目内临时路径(非 `/tmp`)

## 6. 测试策略(TDD)

- **shared.test.ts**:`HarnessToolExecutionEndEvent` 类型 + union 归属(若 shared 有测试)
- **harness.test.ts**:afterToolCall emit 的 tool_execution_end 事件含 args 且类型为 HarnessToolExecutionEndEvent(spy `events.emit` 断言 `args === ctx.args`)
- **instinct.test.ts**:
  - **prefer-args 去重(red-team Important 3 核心)**:emit 两个同 toolCallId 的 tool_execution_end,**一个带 args 一个不带,两种顺序**(带 args 先 / 无 args 先)各测一次 → observations.jsonl 只多一条 tool_call,且该条 `data.argsSummary !== undefined`(assert argsSummary 存活,非仅计数)
  - argsSummary 从 emit 的 args 取(带 args 事件 → observation.data.argsSummary 含参数 JSON 截断)
  - **redact**:bash tool command 含 `API_KEY=sk-xxx` → argsSummary 含 `API_KEY=<redacted>`(非原值)
  - 无 args 事件单独 emit(无重复)→ 不记录 tool_call observation(prefer-args 跳过)
- **回归**:现有 instinct/harness 测试全绿(318 → +N)

## 7. 陷阱

- vitest development condition vs tsc dist:改 harness/shared 后须 `pnpm --filter @agentforge/harness build` + shared build rebuild dist(cli typecheck 才认)
- `AGENTFORGE_PROJECT_DIR` Windows 用 `/tmp` 不存在——T10 用 `%TEMP%\instinct-t10`
- MiMo key 在 `.env`(gitignore),T10 跑真对话需 `source .env` 或 export;key 进历史需轮换(memory 记录)
- TS union 判别:pi AgentEvent 与 HarnessToolExecutionEndEvent 同 `type:"tool_execution_end"`,implementer 验 TS 不报歧义(若报,adapt 用 `(e as {args?: unknown}).args`)
- GateGuard hook 拦新文件/编辑/首次 bash,陈述 4 事实放行

## 8. red-team 审查接入点(已审,见 §9)

- ~~去重环形 Set 竞态/内存~~ → 改 prefer-args 无状态,消除
- ~~afterToolCall 顺序依赖~~ → prefer-args 不依赖顺序,消除
- args 隐私/体积 → D4 redact 处理
- ~~as any~~ → D1 typed event 处理
- T10 retry → D5 处理

## 9. red-team Oracle 审查变更记录(v1 → v2)

| red-team finding | 级别 | v2 处理 |
|---|---|---|
| D2 take-first 依赖未文档化 emergent ordering(pi agent-loop.js + EventBus 同步 + harness 同步组合) | 🔴 Blocking | D2 改 prefer-args(跳过无 args 事件),不依赖顺序 |
| take-first 是错策略,prefer-args 严格更安全零成本 | 🔴 Blocking | 采纳 prefer-args |
| 无测试锁定 dedup-keeps-args(§6 测试会通过无论保留哪个) | 🟡 Important | §6 加"两事件两顺序 + assert argsSummary 存活"测试 |
| args 隐私:bash command 含 secret 未 redact,200-cap truncate mid-secret | 🟡 Important | D4 加 redactArgs(secret pattern redact) |
| ring Set cap-100 arbitrary,并行 batch 可能 evict live id | 🟡 Important | 去掉 ring Set(prefer-args 无状态) |
| as any 论证循环,应 shared typed event ~5 行 | ⚪ Advisory | D1 + §4.1 加 HarnessToolExecutionEndEvent,satisfies 替代 as any |
| T10 单 -p LLM 协作产三类不保证,gate 无 retry | ⚪ Advisory | D5 三类分 session 或 capped N=3 retry |
