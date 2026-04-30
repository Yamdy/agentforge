/**
 * AgentForge Workflow 和 Pipeline 使用示例
 *
 * 本示例展示如何使用 Workflow 子系统进行多步骤编排：
 * - Workflow: 高级抽象，支持多步骤执行和暂停/恢复
 * - SequentialPipeline: 顺序执行，每步接收前一步输出
 * - ParallelPipeline: 并行执行，所有步骤同时运行
 *
 * 运行方式: npx tsx examples/07-workflow.ts
 */

// ============================================================
// 导入核心类型
// ============================================================

import {
  type AgentEvent,
  type AgentContext,
  type LLMAdapter,
  type LLMResponse,
  type Message,
  ContextBuilder,
  InMemoryStore,
  DefaultPauseController,
  generateSessionId,
  isTerminalEvent,
} from '../src/core/index.js';

// Workflow 子系统
import {
  Workflow,
  createWorkflow,
  SequentialPipeline,
  ParallelPipeline,
  createSequentialPipeline,
  createParallelPipeline,
  createPipeline,
  createPromptGenerator,
  createJsonPromptGenerator,
  type WorkflowConfig,
  type WorkflowStep,
  type PipelineConfig,
} from '../src/workflow/index.js';

// ============================================================
// Mock LLM Adapter (用于演示)
// ============================================================

/**
 * 模拟的 LLM Adapter
 *
 * 模拟多步骤工作流中的响应
 */
class MockWorkflowLLMAdapter implements LLMAdapter {
  readonly name = 'mock-workflow-adapter';
  readonly provider = 'mock';
  private callCount = 0;

  // 根据步骤索引返回不同响应
  async chat(messages: Message[], _options?: unknown): Promise<LLMResponse> {
    this.callCount++;

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 100));

    // 根据最后一条消息内容生成响应
    const lastMessage = messages[messages.length - 1];
    const content = typeof lastMessage?.content === 'string' ? lastMessage.content : '';

    // 根据内容关键词返回不同响应
    if (content.includes('搜索')) {
      return {
        content: JSON.stringify({
          results: ['结果1: Agent架构设计', '结果2: Workflow编排模式', '结果3: 最佳实践'],
          total: 3,
        }),
        finishReason: 'stop',
        usage: { promptTokens: 20, completionTokens: 50 },
      };
    }

    if (content.includes('分析')) {
      return {
        content: JSON.stringify({
          summary: '分析完成',
          keyPoints: ['事件流', '类型安全', '可中断恢复'],
          confidence: 0.95,
        }),
        finishReason: 'stop',
        usage: { promptTokens: 30, completionTokens: 40 },
      };
    }

    if (content.includes('总结')) {
      return {
        content: '工作流执行完成，共处理 3 个步骤，生成最终报告。',
        finishReason: 'stop',
        usage: { promptTokens: 50, completionTokens: 30 },
      };
    }

    // 默认响应
    return {
      content: `步骤 ${this.callCount} 完成: ${content.slice(0, 50)}`,
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
    };
  }

  async *stream(_messages: Message[], _options?: unknown): AsyncGenerator<{ text?: string; finishReason?: string }> {
    yield {
      text: '流式响应',
      finishReason: 'stop',
    };
  }
}

// ============================================================
// 辅助函数：创建 AgentContext
// ============================================================

function createMockAgentContext(): AgentContext {
  const llmAdapter = new MockWorkflowLLMAdapter();

  return ContextBuilder.create()
    .withSessionId(generateSessionId())
    .withAgentName('workflow-agent')
    .withLLM({
      provider: 'mock',
      name: 'mock-model',
      chat: llmAdapter.chat.bind(llmAdapter),
      stream: llmAdapter.stream.bind(llmAdapter),
    })
    .withMemory(new InMemoryStore())
    .withPauseController(new DefaultPauseController())
    .build();
}

// ============================================================
// 辅助函数：通过事件监听收集流程事件
// ============================================================

/**
 * 监听 workflow 事件并打印日志，返回收集的事件数组
 */
async function runPipelineAndCollect(
  pipeline: SequentialPipeline | ParallelPipeline,
  input: unknown,
  label: string
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  
  // 使用 onAny 监听所有事件
  const unsub = pipeline.onAny((event) => {
    events.push(event);
    // 手动检查是否为 workflow 事件
    if (event.type.startsWith('workflow.')) {
      console.log(`[${label}] ${event.type}`);
      if (event.type === 'workflow.step.start' && 'stepId' in event) {
        console.log(`  开始步骤: ${event.stepId}`);
      }
      if (event.type === 'workflow.step.end' && 'stepId' in event && 'result' in event) {
        console.log(`  完成步骤: ${event.stepId}, 结果: ${event.result}`);
      }
    }
  });

  await pipeline.run(input);
  unsub();
  return events;
}

// ============================================================
// 示例 1: SequentialPipeline - 顺序执行管道
// ============================================================

async function example1_sequentialPipeline(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 1: SequentialPipeline - 顺序执行');
  console.log('========================================\n');

  const ctx = createMockAgentContext();

  // 定义工作流步骤
  const steps: WorkflowStep[] = [
    {
      id: 'search',
      name: '搜索资料',
      prompt: (input) => `搜索相关资料: ${input}`,
    },
    {
      id: 'analyze',
      name: '分析结果',
      prompt: (input) => `分析以下搜索结果: ${JSON.stringify(input)}`,
    },
    {
      id: 'summarize',
      name: '生成总结',
      prompt: (input) => `总结分析结果: ${JSON.stringify(input)}`,
    },
  ];

  // 创建顺序管道
  const pipeline = createSequentialPipeline(steps, ctx);

  console.log('管道配置:');
  console.log(`  步骤数: ${steps.length}`);
  console.log(`  执行模式: Sequential`);
  steps.forEach((step, i) => {
    console.log(`    ${i + 1}. ${step.name ?? step.id}`);
  });

  // 执行管道
  console.log('\n开始执行...\n');

  const events = await runPipelineAndCollect(pipeline, 'AI Agent 架构', 'Sequential');

  console.log('\n执行完成!');
  console.log(`总事件数: ${events.length}`);

  // 统计事件类型
  const eventCounts = new Map<string, number>();
  for (const event of events) {
    const count = eventCounts.get(event.type) ?? 0;
    eventCounts.set(event.type, count + 1);
  }
  console.log('\n事件统计:');
  eventCounts.forEach((count, type) => {
    console.log(`  ${type}: ${count}`);
  });

  pipeline.destroy();
}

// ============================================================
// 示例 2: ParallelPipeline - 并行执行管道
// ============================================================

async function example2_parallelPipeline(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 2: ParallelPipeline - 并行执行');
  console.log('========================================\n');

  const ctx = createMockAgentContext();

  // 定义并行执行的步骤（所有步骤接收相同输入）
  const steps: WorkflowStep[] = [
    {
      id: 'branch-search',
      name: '搜索分支',
      prompt: (_input) => '搜索 AI Agent 相关论文',
    },
    {
      id: 'branch-analyze',
      name: '分析分支',
      prompt: (_input) => '分析当前 AI Agent 技术趋势',
    },
    {
      id: 'branch-validate',
      name: '验证分支',
      prompt: (_input) => '验证研究方法论',
    },
  ];

  // 创建并行管道（限制并发数）
  const pipeline = createParallelPipeline(steps, ctx, {
    maxConcurrency: 2, // 最多同时执行 2 个步骤
    continueOnFailure: true, // 某步骤失败时继续执行其他步骤
  });

  console.log('管道配置:');
  console.log(`  步骤数: ${steps.length}`);
  console.log(`  执行模式: Parallel`);
  console.log(`  最大并发: 2`);

  // 执行管道
  console.log('\n开始并行执行...\n');

  const startTime = Date.now();
  const workflowEvents: AgentEvent[] = [];

  const unsub = pipeline.onAny((event) => {
    // 手动检查是否为 workflow 事件
    if (event.type.startsWith('workflow.')) {
      workflowEvents.push(event);
      const stepInfo = 'stepId' in event ? `步骤: ${event.stepId}` : '';
      console.log(`[Workflow] ${event.type}${stepInfo ? ` - ${stepInfo}` : ''}`);
    }
  });

  await pipeline.run('AI Agent 研究');
  unsub();

  const duration = Date.now() - startTime;
  console.log(`\n并执行完成! 耗时: ${duration}ms`);
  console.log('(注意: 并行执行总耗时应接近最长单步耗时，而非各步耗时之和)');

  pipeline.destroy();
}

// ============================================================
// 示例 3: 条件步骤执行
// ============================================================

async function example3_conditionalSteps(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 3: 条件步骤执行');
  console.log('========================================\n');

  const ctx = createMockAgentContext();

  // 定义带跳过条件的步骤
  const steps: WorkflowStep[] = [
    {
      id: 'step-check',
      name: '检查输入',
      prompt: (input) => `检查输入: ${input}`,
    },
    {
      id: 'step-process-large',
      name: '处理大数据',
      // 条件：如果输入数据量较小则跳过
      skip: (input) => {
        const data = input as { size?: number };
        return data.size !== undefined && data.size < 1000;
      },
      prompt: (input) => `处理大数据: ${JSON.stringify(input)}`,
    },
    {
      id: 'step-process-small',
      name: '处理小数据',
      // 条件：如果输入数据量较大则跳过
      skip: (input) => {
        const data = input as { size?: number };
        return data.size !== undefined && data.size >= 1000;
      },
      prompt: (input) => `处理小数据: ${JSON.stringify(input)}`,
    },
    {
      id: 'step-finalize',
      name: '完成处理',
      prompt: (input) => `完成处理: ${JSON.stringify(input)}`,
    },
  ];

  // 测试场景 1: 小数据
  console.log('场景 A: 小数据 (size=500)');
  const pipelineA = createSequentialPipeline(steps, ctx);

  const unsubA = pipelineA.onAny((event) => {
    if (event.type === 'workflow.step.end') {
      console.log(`  步骤 ${event.stepId}: ${event.result}`);
    }
  });

  await pipelineA.run({ size: 500 });
  unsubA();
  pipelineA.destroy();

  // 测试场景 2: 大数据
  console.log('\n场景 B: 大数据 (size=5000)');

  // 需要重新创建 context（已销毁）
  const ctx2 = createMockAgentContext();
  const pipelineB = createSequentialPipeline(steps, ctx2);

  const unsubB = pipelineB.onAny((event) => {
    if (event.type === 'workflow.step.end') {
      console.log(`  步骤 ${event.stepId}: ${event.result}`);
    }
  });

  await pipelineB.run({ size: 5000 });
  unsubB();
  pipelineB.destroy();
}

// ============================================================
// 示例 4: Workflow 暂停/恢复
// ============================================================

async function example4_workflow_suspendResume(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 4: Workflow 暂停/恢复');
  console.log('========================================\n');

  const ctx = createMockAgentContext();

  // 创建工作流配置
  const config: WorkflowConfig = {
    id: 'demo-workflow',
    name: '演示工作流',
    steps: [
      {
        id: 'init',
        name: '初始化',
        prompt: (input) => `初始化任务: ${input}`,
      },
      {
        id: 'process',
        name: '处理',
        prompt: (input) => `处理数据: ${JSON.stringify(input)}`,
      },
      {
        id: 'complete',
        name: '完成',
        prompt: (input) => `完成任务: ${JSON.stringify(input)}`,
      },
    ],
  };

  // 创建 Workflow 实例
  const workflow = createWorkflow(config, ctx);

  console.log('工作流配置:');
  console.log(`  ID: ${config.id}`);
  console.log(`  名称: ${config.name}`);
  console.log(`  步骤数: ${config.steps.length}`);

  // 执行工作流
  console.log('\n开始执行...\n');

  const events: AgentEvent[] = [];
  let workflowId = '';

  const unsub = workflow.onAny((event) => {
    events.push(event);

    // 提取 workflowId
    const id = 'workflowId' in event ? event.workflowId : undefined;
    if (id !== undefined && workflowId === '') {
      workflowId = id;
    }

    // 手动检查是否为 workflow 事件
    if (event.type.startsWith('workflow.')) {
      console.log(`[${event.type}]`);
      if (event.type === 'workflow.step.start' && 'stepId' in event) {
        const stepName = 'stepName' in event ? event.stepName : event.stepId;
        console.log(`  步骤: ${stepName}`);
      }
      if (event.type === 'workflow.step.end' && 'result' in event) {
        console.log(`  结果: ${event.result}`);
      }
    }
  });

  await workflow.run('演示任务');
  unsub();

  console.log(`\n工作流 ID: ${workflowId}`);

  // 获取执行上下文
  const execCtx = workflow.getExecutionContext();
  if (execCtx !== null) {
    console.log('执行上下文:');
    console.log(`  状态: ${execCtx.state}`);
    console.log(`  总步骤数: ${execCtx.totalSteps}`);
    console.log(`  输出数: ${execCtx.stepOutputs.size}`);
  }

  workflow.destroy();
}

// ============================================================
// 示例 5: 使用 Prompt 生成器
// ============================================================

async function example5_promptGenerators(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 5: Prompt 生成器');
  console.log('========================================\n');

  // 简单模板生成器
  const simplePrompt = createPromptGenerator('请分析以下内容: {{input}}');
  console.log('简单模板生成器:');
  console.log(`  输入: "AI Agent"`);
  console.log(`  输出: ${simplePrompt('AI Agent')}`);

  // JSON 结构化生成器
  const jsonPrompt = createJsonPromptGenerator('处理以下结构化数据: {{input}}');
  console.log('\nJSON 结构化生成器:');
  console.log(`  输入: { topic: "AI", year: 2024 }`);
  console.log(`  输出: ${jsonPrompt({ topic: 'AI', year: 2024 })}`);

  // 自定义条件生成器
  const conditionalPrompt = (input: unknown): string => {
    const data = input as { type?: string; content?: string };
    if (data.type === 'search') {
      return `搜索查询: ${data.content ?? ''}`;
    }
    if (data.type === 'analyze') {
      return `深度分析: ${JSON.stringify(data.content)}`;
    }
    return `处理输入: ${JSON.stringify(input)}`;
  };

  console.log('\n自定义条件生成器:');
  console.log(`  搜索类型: ${conditionalPrompt({ type: 'search', content: 'AI Agent' })}`);
  console.log(`  分析类型: ${conditionalPrompt({ type: 'analyze', content: { data: [1, 2, 3] } })}`);
}

// ============================================================
// 示例 6: 创建 Pipeline 的多种方式
// ============================================================

async function example6_pipelineFactories(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 6: Pipeline 工厂方法');
  console.log('========================================\n');

  const ctx = createMockAgentContext();

  const steps: WorkflowStep[] = [
    { id: 'step1', prompt: () => '步骤 1' },
    { id: 'step2', prompt: () => '步骤 2' },
  ];

  // 方式 1: 直接使用构造函数
  console.log('方式 1: 构造函数');
  const pipeline1 = new SequentialPipeline(steps, ctx);
  console.log(`  类型: ${pipeline1.constructor.name}`);

  // 方式 2: 使用工厂函数
  console.log('\n方式 2: 工厂函数');
  const pipeline2 = createSequentialPipeline(steps, ctx, { continueOnFailure: true });
  console.log(`  类型: ${pipeline2.constructor.name}`);

  // 方式 3: 使用统一工厂，通过配置决定类型
  console.log('\n方式 3: 统一工厂');
  const config: PipelineConfig = {
    mode: 'parallel',
    steps,
    maxConcurrency: 4,
  };
  const pipeline3 = createPipeline(config, ctx);
  console.log(`  模式: parallel`);
  console.log(`  类型: ${pipeline3.constructor.name}`);

  // 清理
  pipeline1.destroy();
  pipeline2.destroy();
  pipeline3.destroy();

  console.log('\n三种方式创建的 Pipeline 都已正确销毁');
}

// ============================================================
// 示例 7: 错误处理
// ============================================================

async function example7_errorHandling(): Promise<void> {
  console.log('\n========================================');
  console.log('示例 7: 错误处理');
  console.log('========================================\n');

  // 创建带超时的步骤配置
  const ctx = createMockAgentContext();

  const steps: WorkflowStep[] = [
    {
      id: 'normal-step',
      name: '正常步骤',
      prompt: () => '正常执行',
    },
    {
      id: 'timeout-step',
      name: '超时步骤',
      prompt: () => '这个步骤会超时',
      timeout: 50, // 50ms 超时（模拟数据响应需要100ms）
    },
    {
      id: 'recovery-step',
      name: '恢复步骤',
      prompt: () => '从错误恢复',
    },
  ];

  // 测试 continueOnFailure: false（默认行为，出错即停止）
  console.log('场景 A: continueOnFailure = false');
  const pipelineA = createSequentialPipeline(steps, ctx);

  try {
    const unsubA = pipelineA.onAny((event) => {
      if (event.type === 'workflow.error') {
        console.log(`  [错误] 步骤: ${event.stepId}`);
      }
      if (event.type === 'workflow.step.end') {
        console.log(`  [步骤结束] ${event.stepId}: ${event.result}`);
      }
    });

    await pipelineA.run('测试');
    unsubA();
  } catch (error) {
    console.log(`  预期的错误: ${error}`);
  }

  pipelineA.destroy();

  // 测试 continueOnFailure: true（继续执行后续步骤）
  console.log('\n场景 B: continueOnFailure = true');
  const ctx2 = createMockAgentContext();
  const pipelineB = createSequentialPipeline(steps, ctx2, { continueOnFailure: true });

  const unsubB = pipelineB.onAny((event) => {
    if (event.type === 'workflow.error') {
      console.log(`  [错误] 步骤: ${event.stepId} (继续执行)`);
    }
    if (event.type === 'workflow.step.end') {
      console.log(`  [步骤结束] ${event.stepId}: ${event.result}`);
    }
  });

  await pipelineB.run('测试');
  unsubB();
  pipelineB.destroy();
  console.log('  Pipeline 继续执行了其他步骤');
}

// ============================================================
// 主入口
// ============================================================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║     AgentForge Workflow 使用示例            ║');
  console.log('╚════════════════════════════════════════════╝');

  try {
    // 运行所有示例
    await example1_sequentialPipeline();
    await example2_parallelPipeline();
    await example3_conditionalSteps();
    await example4_workflow_suspendResume();
    await example5_promptGenerators();
    await example6_pipelineFactories();
    await example7_errorHandling();

    console.log('\n========================================');
    console.log('所有示例运行完成！');
    console.log('========================================\n');
  } catch (error) {
    console.error('示例执行出错:', error);
    process.exit(1);
  }
}

// 运行主函数
main();
