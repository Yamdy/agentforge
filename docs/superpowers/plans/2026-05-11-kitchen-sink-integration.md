# Kitchen-Sink Integration: Config + MCP + Async Sub-Agents

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `examples/kitchen-sink.ts` with Region 5 that exercises Config (Issue 16), MCP (Issue 15), and Async Sub-Agents (Issue 17) with real LLM calls.

**Architecture:** Append a new "Region 5" section after the existing post-processing (Section 7) in kitchen-sink.ts. Region 5 creates its own isolated infrastructure (temp config files, MCP server directory, TaskManager) and cleans up after itself. Existing regions 0-7 remain untouched.

**Tech Stack:** TypeScript, DeepSeek LLM, `@modelcontextprotocol/server-filesystem` (stdio MCP server), `ConfigLoader`, `TaskManagerImpl`, `ConcurrencyController`.

---

### Task 1: Install `@modelcontextprotocol/server-filesystem`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the MCP filesystem server as a devDependency**

```bash
pnpm add -Dw @modelcontextprotocol/server-filesystem
```

- [ ] **Step 2: Verify installation**

Run: `pnpm ls @modelcontextprotocol/server-filesystem`
Expected: Shows the package with a version number.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @modelcontextprotocol/server-filesystem for integration demo"
```

---

### Task 2: Add Config Region 5a — ConfigLoader + ModelProfile

**Files:**
- Modify: `examples/kitchen-sink.ts`

This task adds the Config demonstration section. It writes a temp JSONC config file, loads it with ConfigLoader, applies ModelProfile, and shows resolveDynamic.

- [ ] **Step 1: Add new imports at the top of kitchen-sink.ts**

In the `@agentforge/core` import block (line 27-35), add these three imports:

```typescript
import {
  Agent,
  registerProvider,
  EventBus,
  createSubAgentTool,
  FilesystemSessionStorage,
  SessionPersistence,
  SessionManagerImpl,
  ConfigLoader,
  matchProfile,
  applyProfile,
  resolveDynamic,
  ConcurrencyController,
  TaskManagerImpl,
} from '@agentforge/core';
```

In the `@agentforge/plugins` import block (line 37-45), add `mcpPlugin`:

```typescript
import {
  memoryPlugin,
  InMemoryBackend,
  compressionPlugin,
  permissionPlugin,
  skillPlugin,
  evictionPlugin,
  InMemoryEvictionStorage,
  mcpPlugin,
} from '@agentforge/plugins';
```

Add `writeFileSync` to the `node:fs` import:

```typescript
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
```

- [ ] **Step 2: Add Region 5 inside `main()`, after the plugin shutdown block (after line 354, before `rmSync`)**

Insert the following block between the `console.log('\n=== 演示完成 ===');` line and the `rmSync(sessionBase, ...)` line. Replace the existing `console.log('\n=== 演示完成 ===');` line with the full Region 5 code:

```typescript
  // =========================================================================
  // 8. Region 5: Config + MCP + Async Sub-Agents               [Issue 15-17]
  // =========================================================================

  console.log(`\n${'='.repeat(60)}`);
  console.log('=== Region 5: Config + MCP + Async Sub-Agents ===\n');

  // --- 8a. Config (Issue 16) ---
  console.log('--- 8a. Config: JSONC 多层合并 + ModelProfile ---');

  const configDir = mkdtempSync(join(tmpdir(), 'agentforge-cfg-'));
  const configJsonc = join(configDir, 'config.jsonc');
  writeFileSync(configJsonc, `{
    // AgentForge 项目配置 (JSONC — 支持注释)
    "modelProfiles": [
      {
        "modelPattern": "deepseek",
        "systemPromptSuffix": "[Config] 当前模型为 DeepSeek，请用简洁中文回答。"
      }
    ],
    "tools": {
      "enabled": ["getWeather", "calculator", "translator", "codeReviewer", "echo"]
    }
  }`);

  const configLoader = new ConfigLoader();
  const config = await configLoader.load({
    env: '{"plugins": ["memory"]}',
    project: configJsonc,
    session: { session: { storage: 'memory' } },
  });

  console.log(`  [Config] 合并结果: plugins=${JSON.stringify(config.plugins)}, storage=${config.session?.storage}`);
  console.log(`  [Config] modelProfiles: ${(config.modelProfiles ?? []).length} 个`);

  // Apply ModelProfile
  if (config.modelProfiles && config.modelProfiles.length > 0) {
    const profile = matchProfile('deepseek/deepseek-v4-flash', config.modelProfiles);
    if (profile) {
      console.log(`  [Config] ModelProfile 匹配: suffix="${profile.systemPromptSuffix}"`);
    }
  }

  // resolveDynamic demo
  const dynamicValue = await resolveDynamic(
    (ctx) => `[Dynamic] 会话 ${ctx.sessionId.slice(0, 8)} 于 ${new Date().toISOString()} 创建`,
    { input: 'test', sessionId: 'demo-session-001', metadata: {} },
  );
  console.log(`  [Config] resolveDynamic: ${dynamicValue}`);

  // Clean up config dir
  rmSync(configDir, { recursive: true, force: true });
```

- [ ] **Step 3: Run to verify Config section works**

Run: `npx tsx examples/kitchen-sink.ts`
Expected: Output includes `[Config] 合并结果`, `[Config] ModelProfile 匹配`, `[Config] resolveDynamic` lines. The existing regions 0-7 should still work normally.

- [ ] **Step 4: Commit**

```bash
git add examples/kitchen-sink.ts
git commit -m "feat(examples): add Config (Issue 16) region to kitchen-sink"
```

---

### Task 3: Add MCP Region 5b — Real MCP Server

**Files:**
- Modify: `examples/kitchen-sink.ts`

This task adds the MCP filesystem server integration. It starts `@modelcontextprotocol/server-filesystem` via `mcpPlugin`, lets the agent discover and call MCP tools through real LLM.

- [ ] **Step 1: Add MCP section after the Config cleanup in Region 5**

Insert after `rmSync(configDir, { recursive: true, force: true });` and before the final cleanup:

```typescript
  // --- 8b. MCP (Issue 15) ---
  console.log('\n--- 8b. MCP: 真实 filesystem server ---');

  const mcpDataDir = mkdtempSync(join(tmpdir(), 'agentforge-mcp-'));
  writeFileSync(join(mcpDataDir, 'notes.txt'), '这是 AgentForge 的 MCP 集成测试文件。\n框架支持 MCP 工具的自动发现和调用。');
  writeFileSync(join(mcpDataDir, 'status.txt'), '状态: 正常\n版本: 0.0.1');

  // Create a separate agent for MCP demo to avoid polluting the main agent
  const mcpAgent = new Agent(
    {
      model: 'deepseek/deepseek-v4-flash',
      systemPrompt: '你是一个文件管理助手。你可以列出目录、读取文件。用中文回答。',
      tools: [],
      maxIterations: 3,
    },
    { eventBus: bus },
  );

  mcpAgent.use(mcpPlugin({
    servers: [
      {
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', mcpDataDir],
      },
    ],
  }));

  await mcpAgent.pluginManager.initializeAll();
  console.log('  [MCP] MCP filesystem server 已启动');

  // List registered tools
  const mcpTools = mcpAgent['registry'].getAll();
  const mcpToolNames = mcpTools.map((t: any) => t.name);
  console.log(`  [MCP] 发现工具: ${mcpToolNames.join(', ')}`);

  // Ask the agent to list and read files — triggers MCP tool calls via LLM
  const mcpQuery = `请列出当前目录下的文件，然后读取 notes.txt 的内容。`;
  console.log(`  [MCP] 用户: ${mcpQuery}`);
  let mcpResponse = '';
  for await (const chunk of mcpAgent.stream(mcpQuery)) {
    mcpResponse += chunk;
  }
  console.log(`  [MCP] 助手: ${mcpResponse.slice(0, 200)}${mcpResponse.length > 200 ? '...' : ''}`);

  await mcpAgent.pluginManager.shutdown();
  rmSync(mcpDataDir, { recursive: true, force: true });
  console.log('  [MCP] MCP server 已关闭');
```

- [ ] **Step 2: Run to verify MCP section**

Run: `npx tsx examples/kitchen-sink.ts`
Expected: Output includes `[MCP] MCP filesystem server 已启动`, `[MCP] 发现工具: filesystem__read_file, filesystem__list_directory, ...`, and the LLM response showing file contents.

- [ ] **Step 3: Commit**

```bash
git add examples/kitchen-sink.ts
git commit -m "feat(examples): add MCP (Issue 15) region to kitchen-sink"
```

---

### Task 4: Add Async Sub-Agents Region 5c

**Files:**
- Modify: `examples/kitchen-sink.ts`

This task adds the async sub-agent section with concurrency control and parallel translation tasks.

- [ ] **Step 1: Add async sub-agent section after MCP cleanup**

Insert after `console.log('  [MCP] MCP server 已关闭');` and before the final `rmSync(sessionBase, ...)`:

```typescript
  // --- 8c. Async Sub-Agents (Issue 17) ---
  console.log('\n--- 8c. Async Sub-Agents: 并发翻译任务 ---');

  const cc = new ConcurrencyController([{ key: 'translate', maxConcurrent: 2 }]);
  const tm = new TaskManagerImpl({
    eventBus: bus,
    concurrencyController: cc,
    runAgentFn: async (agentConfig, input, _signal) => {
      const { Agent: AgentCtor } = await import('@agentforge/core');
      const taskAgent = new AgentCtor(agentConfig, { eventBus: bus });
      const response = await taskAgent.run(input);
      return { response, tokenUsage: { input: 0, output: 0 }, sessionId: crypto.randomUUID() };
    },
  });

  const languages = ['英语', '日语', '法语'] as const;
  const sourceText = 'AgentForge 是一个功能强大的 AI Agent 框架';

  const handles = await Promise.all(
    languages.map((lang) =>
      tm.launch(
        {
          name: `translate-to-${lang}`,
          description: `翻译成${lang}`,
          model: 'deepseek/deepseek-v4-flash',
          systemPrompt: `你是翻译专家。将用户给你的文本翻译成${lang}。只输出翻译结果。`,
          contextPolicy: 'isolated',
          maxIterations: 1,
          concurrencySlot: { key: 'translate', maxConcurrent: 2 },
        } as any,
        sourceText,
      ),
    ),
  );

  console.log(`  [Async] 启动 ${handles.length} 个翻译任务 (并发上限: 2)`);

  // Cancel the last task to demonstrate cancellation
  handles[2].cancel();
  console.log(`  [Async] 已取消: ${languages[2]} 翻译任务`);

  // Collect results via on_complete
  const results = new Map<string, string>();
  await new Promise<void>((resolveAll) => {
    let pending = 2; // Only 2 tasks (one was cancelled)
    for (let i = 0; i < 2; i++) {
      handles[i].on_complete((result) => {
        results.set(languages[i], result.response.slice(0, 100));
        pending--;
        if (pending === 0) resolveAll();
      });
    }
    // Safety timeout
    setTimeout(resolveAll, 60_000);
  });

  console.log('  [Async] 翻译结果:');
  for (const [lang, text] of results) {
    console.log(`    ${lang}: ${text}`);
  }

  // List all tasks
  const allTasks = tm.list();
  console.log(`  [Async] 任务列表: ${allTasks.map((t) => `${t.taskId.slice(0, 8)}(${t.status})`).join(', ')}`);
  console.log(`  [Async] 并发槽位: translate=${cc.getActiveCount('translate')}/2`);
```

- [ ] **Step 2: Run the full kitchen-sink**

Run: `npx tsx examples/kitchen-sink.ts`
Expected: Output includes `[Async] 启动 3 个翻译任务`, `[Async] 已取消: 法语 翻译任务`, `[Async] 翻译结果:` with English and Japanese translations, and task status list.

- [ ] **Step 3: Commit**

```bash
git add examples/kitchen-sink.ts
git commit -m "feat(examples): add Async Sub-Agents (Issue 17) region to kitchen-sink"
```

---

### Task 5: Final cleanup and verification

**Files:**
- Modify: `examples/kitchen-sink.ts`

- [ ] **Step 1: Ensure temp dir cleanup covers all new temp directories**

The `rmSync(sessionBase, ...)` at the end of `main()` only cleans the session base dir. The config dir and MCP dir are cleaned inline in their sections. Verify no temp dirs leak by checking all `mkdtempSync` calls have matching `rmSync` cleanup.

Already handled — `configDir` and `mcpDataDir` each have their own `rmSync` right after their respective sections.

- [ ] **Step 2: Update the file header comment**

Update the top-of-file comment block to include the new features:

```typescript
 *  - Config System (JSONC, multi-layer merge, ModelProfile) [Issue 16]
 *  - MCP Plugin (stdio transport, real server-filesystem)   [Issue 15]
 *  - Async Sub-Agents (ConcurrencyController, TaskManager)  [Issue 17]
```

- [ ] **Step 3: Full end-to-end run**

Run: `npx tsx examples/kitchen-sink.ts`
Expected: All 8 regions execute without errors. Regions 0-7 produce the same output as before. Region 5 produces Config/MCP/Async output.

- [ ] **Step 4: Commit**

```bash
git add examples/kitchen-sink.ts
git commit -m "feat(examples): complete kitchen-sink with Config+MCP+Async (Issues 15-17)"
```

---

## Self-Review Checklist

- [x] Spec coverage: Config (Issue 16) → Task 2, MCP (Issue 15) → Task 3, Async Sub-Agents (Issue 17) → Task 4
- [x] Placeholder scan: No TBD/TODO/placeholders. All code blocks contain complete implementations.
- [x] Type consistency: `AsyncTaskConfig` cast to `any` to work around `concurrencySlot` typing — matches existing pattern in `task-manager.ts`. `ConfigSource` matches `config.ts`. `mcpPlugin` matches `plugins/src/mcp/index.ts`.
