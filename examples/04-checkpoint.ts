/**
 * AgentForge Checkpoint and Recovery Example
 *
 * Demonstrates how to use the checkpoint operator to save agent state,
 * and how to recover from a saved checkpoint.
 *
 * Key concepts:
 * 1. Checkpoint positions: before_llm, after_llm, before_tool, after_tool
 * 2. Fire-and-forget saves (never blocks the stream)
 * 3. Recovery continues from checkpoint boundary
 */

import {
  type AgentEvent,
  type Checkpoint,
  type CheckpointStorage,
  type CheckpointPosition,
  type AgentState,
  serializeCheckpoint,
  deserializeCheckpoint,
  createRecoveryCheckpoint,
  getRecoveryInfo,
} from '../src/core/index.js';

// ============================================================
// InMemoryCheckpointStorage Implementation
// ============================================================

/**
 * 内存检查点存储实现
 *
 * 用于演示和测试。生产环境应使用持久化存储（如 SQLite、Redis）。
 */
class InMemoryCheckpointStorage implements CheckpointStorage {
  private readonly checkpoints = new Map<string, Checkpoint>();

  /**
   * 保存检查点
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(checkpoint.id, checkpoint);
    console.log(`[Checkpoint] 已保存: ${checkpoint.id}, 位置: ${checkpoint.position}`);
  }

  /**
   * 加载指定会话的最新检查点
   */
  async load(sessionId: string): Promise<Checkpoint | null> {
    const sessionCheckpoints = await this.list(sessionId);
    if (sessionCheckpoints.length === 0) {
      return null;
    }
    // 返回时间戳最新的
    return sessionCheckpoints.reduce((latest, cp) =>
      cp.timestamp > latest.timestamp ? cp : latest
    );
  }

  /**
   * 列出所有检查点（可按会话过滤）
   */
  async list(sessionId?: string): Promise<Checkpoint[]> {
    const all = Array.from(this.checkpoints.values());
    if (sessionId === undefined) {
      return all;
    }
    return all.filter(cp => cp.sessionId === sessionId);
  }

  /**
   * 删除指定检查点
   */
  async delete(id: string): Promise<void> {
    this.checkpoints.delete(id);
  }

  /**
   * 删除会话的所有检查点
   */
  async deleteAll(sessionId: string): Promise<void> {
    const entries = Array.from(this.checkpoints.entries());
    for (const [id, cp] of entries) {
      if (cp.sessionId === sessionId) {
        this.checkpoints.delete(id);
      }
    }
  }
}

// ============================================================
// Example 1: Basic Checkpoint Configuration
// ============================================================

/**
 * 示例 1: 基础检查点配置
 *
 * 展示如何创建检查点存储，并在事件流中使用。
 */
async function example1_basicCheckpoint(): Promise<void> {
  console.log('\n=== 示例 1: 基础检查点配置 ===\n');

  // 创建内存检查点存储
  const storage = new InMemoryCheckpointStorage();
  const sessionId = 'session-demo-001';

  // 模拟事件流
  const mockEvents: AgentEvent[] = [
    { type: 'agent.start', timestamp: Date.now(), sessionId, input: '开始任务' },
    { type: 'agent.step', timestamp: Date.now(), sessionId, step: 1, maxSteps: 5 },
    { type: 'llm.request', timestamp: Date.now(), sessionId },
    { type: 'llm.response', timestamp: Date.now(), sessionId, content: '响应内容', finishReason: 'stop' },
    { type: 'tool.call', timestamp: Date.now(), sessionId, toolCallId: 'tc-1', toolName: 'search', args: {} },
    { type: 'tool.result', timestamp: Date.now(), sessionId, toolCallId: 'tc-1', toolName: 'search', result: '搜索结果' },
    { type: 'agent.complete', timestamp: Date.now(), sessionId, output: '任务完成' },
    { type: 'done', timestamp: Date.now(), sessionId, reason: 'stop' },
  ];

  // 模拟状态提供者
  let currentState: AgentState = {
    sessionId,
    agentName: 'demo-agent',
    model: { provider: 'openai', model: 'gpt-4' },
    messages: [],
    pendingToolCalls: [],
    step: 0,
    maxSteps: 5,
    output: '',
    tokens: { prompt: 0, completion: 0 },
  };

  // 遍历事件流并保存检查点
  for (const event of mockEvents) {
    console.log(`[事件] ${event.type}`);

    // 在特定事件时保存检查点
    if (event.type === 'llm.response' || event.type === 'tool.result') {
      // 构建检查点数据
      const checkpoint: Checkpoint = {
        id: `cp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sessionId,
        timestamp: Date.now(),
        position: event.type === 'llm.response' ? 'after_llm' : 'after_tool',
        state: { ...currentState },
        pendingA2A: [],
        executedTools: [],
        recoveryMetadata: {},
        compactionHistory: [],
      };
      await storage.save(checkpoint);
    }

    // 更新模拟状态
    if (event.type === 'llm.response') {
      currentState = {
        ...currentState,
        messages: [...currentState.messages, { role: 'assistant', content: event.content }],
        step: currentState.step + 1,
      };
    }
    if (event.type === 'tool.result') {
      currentState = {
        ...currentState,
        messages: [
          ...currentState.messages,
          { role: 'tool', content: event.result, toolCallId: event.toolCallId },
        ],
      };
    }

    // 遇到 done 事件则停止
    if (event.type === 'done') break;
  }

  console.log('\n事件处理完成，检查已保存的检查点...');
  const saved = await storage.list(sessionId);
  console.log(`共保存 ${saved.length} 个检查点:`);
  saved.forEach(cp => {
    console.log(`  - ID: ${cp.id}`);
    console.log(`    位置: ${cp.position}`);
    console.log(`    时间: ${new Date(cp.timestamp).toISOString()}`);
    console.log(`    步数: ${cp.state.step}`);
  });
}

// ============================================================
// Example 2: Checkpoint Serialization
// ============================================================

/**
 * 示例 2: 检查点序列化与反序列化
 *
 * 展示如何将检查点保存为 JSON 字符串，以及从 JSON 恢复。
 */
function example2_serialization(): void {
  console.log('\n=== 示例 2: 检查点序列化 ===\n');

  const sessionId = 'session-serialization';

  // 创建一个示例检查点
  const originalCheckpoint: Checkpoint = {
    id: 'cp-example-001',
    sessionId,
    timestamp: Date.now(),
    position: 'after_llm',
    state: {
      sessionId,
      agentName: 'example-agent',
      model: { provider: 'openai', model: 'gpt-4' },
      messages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么我可以帮助你的吗？' },
      ],
      pendingToolCalls: [],
      step: 1,
      maxSteps: 10,
      output: '',
      tokens: { prompt: 10, completion: 20 },
    },
    pendingA2A: [],
    executedTools: [],
    recoveryMetadata: { recoveryCount: 0 },
    compactionHistory: [],
  };

  // 序列化为 JSON 字符串
  const jsonString = serializeCheckpoint(originalCheckpoint);
  console.log('序列化后的 JSON (前 200 字符):');
  console.log(jsonString.slice(0, 200) + '...');

  // 反序列化回检查点对象
  const restoredCheckpoint = deserializeCheckpoint(jsonString);
  console.log('\n反序列化成功！');
  console.log(`  ID: ${restoredCheckpoint.id}`);
  console.log(`  位置: ${restoredCheckpoint.position}`);
  console.log(`  消息数: ${restoredCheckpoint.state.messages.length}`);
  console.log(`  步数: ${restoredCheckpoint.state.step}`);

  // 验证数据完整性
  console.log('\n验证数据完整性:');
  console.log(`  ID 匹配: ${originalCheckpoint.id === restoredCheckpoint.id}`);
  console.log(`  时间戳匹配: ${originalCheckpoint.timestamp === restoredCheckpoint.timestamp}`);
  console.log(`  消息数匹配: ${originalCheckpoint.state.messages.length === restoredCheckpoint.state.messages.length}`);
}

// ============================================================
// Example 3: Recovery Flow
// ============================================================

/**
 * 示例 3: 从检查点恢复
 *
 * 展示如何加载保存的检查点，并从中恢复执行。
 */
async function example3_recovery(): Promise<void> {
  console.log('\n=== 示例 3: 从检查点恢复 ===\n');

  // 模拟一个已保存的检查点（代表中断点）
  const sessionId = 'session-interrupted';
  const savedCheckpoint: Checkpoint = {
    id: 'cp-interrupted-001',
    sessionId,
    timestamp: Date.now() - 3600000, // 1小时前
    position: 'after_tool',
    state: {
      sessionId,
      agentName: 'interrupted-agent',
      model: { provider: 'openai', model: 'gpt-4' },
      messages: [
        { role: 'user', content: '分析这个数据集' },
        { role: 'assistant', content: '我来帮你分析...' },
        { role: 'tool', content: '数据已加载', toolCallId: 'tc-load' },
      ],
      pendingToolCalls: [
        { id: 'tc-analyze', name: 'analyze', args: { dataset: 'sales-2024' } },
      ],
      step: 3,
      maxSteps: 10,
      output: '',
      tokens: { prompt: 150, completion: 80 },
    },
    pendingA2A: [],
    executedTools: [
      { toolCallId: 'tc-load', toolName: 'loadData', idempotencyKey: `${sessionId}:tc-load`, executedAt: Date.now() - 3600000 },
    ],
    recoveryMetadata: { recoveryCount: 0 },
    compactionHistory: [],
  };

  console.log('原始检查点:');
  console.log(`  会话 ID: ${savedCheckpoint.sessionId}`);
  console.log(`  位置: ${savedCheckpoint.position}`);
  console.log(`  步数: ${savedCheckpoint.state.step}/${savedCheckpoint.state.maxSteps}`);
  console.log(`  待处理工具调用: ${savedCheckpoint.state.pendingToolCalls.length}`);

  // 创建恢复检查点（分配新的会话 ID）
  const newSessionId = 'session-recovered-' + Date.now().toString(36);
  const recoveryCheckpoint = createRecoveryCheckpoint(savedCheckpoint, newSessionId);

  console.log('\n恢复检查点:');
  console.log(`  新会话 ID: ${recoveryCheckpoint.sessionId}`);
  console.log(`  新检查点 ID: ${recoveryCheckpoint.id}`);

  // 查看恢复信息
  const recoveryInfo = getRecoveryInfo(recoveryCheckpoint);
  console.log('\n恢复元数据:');
  console.log(`  是否为恢复: ${recoveryInfo.hasRecovery}`);
  console.log(`  恢复次数: ${recoveryInfo.recoveryCount}`);
  console.log(`  原始会话: ${recoveryInfo.originalSessionId ?? '无'}`);

  // 在实际应用中，这里会：
  // 1. 创建新的 AgentContext 使用恢复的状态
  // 2. 继续执行 pendingToolCalls
  // 3. 从 after_tool 位置继续 LLM 请求循环

  console.log('\n模拟恢复执行流程:');
  console.log(`  1. 加载检查点状态 (step=${recoveryCheckpoint.state.step})`);
  console.log(`  2. 恢复对话历史 (${recoveryCheckpoint.state.messages.length} 条消息)`);
  console.log(`  3. 处理待处理的工具调用 (${recoveryCheckpoint.state.pendingToolCalls.length} 个)`);

  // 检查幂等性 - 已执行的工具不会重复执行
  const wasExecuted = savedCheckpoint.executedTools?.some(t => t.toolCallId === 'tc-load') ?? false;
  console.log(`  4. 检查工具幂等性: loadData 已执行=${wasExecuted}`);

  console.log(`  5. 继续新的 LLM 请求循环...`);
}

// ============================================================
// Example 4: Checkpoint Positions
// ============================================================

/**
 * 示例 4: 理解检查点位置
 *
 * 不同位置的语义和恢复行为。
 */
function example4_positions(): void {
  console.log('\n=== 示例 4: 检查点位置语义 ===\n');

  const positions: CheckpointPosition[] = ['before_llm', 'after_llm', 'before_tool', 'after_tool'];

  console.log('检查点位置及其恢复行为:\n');
  console.log('| 位置        | 含义                   | 恢复起点             |');
  console.log('|-------------|------------------------|----------------------|');
  console.log('| before_llm  | LLM 请求前             | 发起 LLM 请求        |');
  console.log('| after_llm   | LLM 响应后             | 处理 toolCalls       |');
  console.log('| before_tool | 工具执行前             | 执行工具             |');
  console.log('| after_tool  | 工具完成后             | 下一轮 LLM 请求      |');

  console.log('\n选择检查点位置的建议:\n');
  console.log('- after_llm: 适合保存 LLM 的决策（工具调用）');
  console.log('- after_tool: 适合保存工具执行结果（幂等恢复）');
  console.log('- before_llm: 适合在重试场景（网络错误恢复）');
  console.log('- before_tool: 适合需要确认工具执行的场景');
}

// ============================================================
// Main Entry Point
// ============================================================

async function main(): Promise<void> {
  console.log('========================================');
  console.log('AgentForge 检查点和恢复示例');
  console.log('========================================');

  await example1_basicCheckpoint();
  example2_serialization();
  await example3_recovery();
  example4_positions();

  console.log('\n========================================');
  console.log('示例执行完成');
  console.log('========================================');
}

// 运行示例
main().catch(console.error);
