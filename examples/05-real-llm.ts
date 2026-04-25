/**
 * AgentForge 真实 LLM 示例 - 使用 AI SDK (Vercel AI SDK)
 *
 * 本示例展示如何使用真实 LLM 驱动 AgentForge 框架。
 * 使用 @ai-sdk/openai-compatible 适配器，支持任何 OpenAI-compatible API。
 *
 * 运行前准备:
 * 1. 安装依赖: npm install ai @ai-sdk/openai-compatible
 * 2. 设置环境变量: OPENAI_API_KEY 或 OPENAI_BASE_URL（用于自定义 endpoint）
 * 3. 运行: npx tsx examples/05-real-llm.ts
 *
 * 支持的 Provider:
 * - OpenAI (官方)
 * - Azure OpenAI
 * - Groq
 * - DeepSeek
 * - Together AI
 * - 任何 OpenAI-compatible API
 */

import { generateText, streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Observable, from, map } from 'rxjs';

// ============================================================
// 导入 AgentForge
// ============================================================

import { createAgent, type AgentConfig } from '../src/api/create-agent.js';
import type { AgentEvent } from '../src/core/events.js';
import type { LLMAdapter, LLMResponse, LLMChunk, LLMOptions } from '../src/core/interfaces.js';
import type { Message } from '../src/core/state.js';

// ============================================================
// 配置 - 从环境变量读取
// ============================================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const MODEL_NAME = process.env.MODEL_NAME ?? 'gpt-4o-mini';

// ============================================================
// AI SDK Provider 配置
// ============================================================

/**
 * 创建 OpenAI-compatible provider
 *
 * 支持多种 Provider，只需更改 baseURL:
 * - OpenAI: https://api.openai.com/v1
 * - Azure: https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT
 * - Groq: https://api.groq.com/openai/v1
 * - DeepSeek: https://api.deepseek.com/v1
 * - Together: https://api.together.xyz/v1
 */
const provider = createOpenAICompatible({
  name: 'openai-compatible',
  baseURL: OPENAI_BASE_URL,
  apiKey: OPENAI_API_KEY,
});

const model = provider(MODEL_NAME);

// ============================================================
// AgentForge LLMAdapter 实现
// ============================================================

/**
 * 基于 AI SDK 的 LLMAdapter 实现
 *
 * 实现 AgentForge 的 LLMAdapter 接口，使用 Vercel AI SDK 作为底层。
 * 
 * 注意: AgentForge 的 LLMAdapter 接口定义:
 * - chat(messages, options?) → Promise<LLMResponse>
 * - stream(messages, options?) → Observable<LLMChunk>
 */
class AISDKAdapter implements LLMAdapter {
  readonly name = 'ai-sdk-adapter';

  /**
   * 将 AgentForge Message 格式转换为 AI SDK 格式
   */
  private convertMessages(messages: Message[]): Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }> {
    return messages.map(msg => {
      // AI SDK 使用简单的 role/content 格式
      const role = msg.role as 'system' | 'user' | 'assistant';
      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
      return { role, content };
    });
  }

  /**
   * 非流式调用 - chat 方法
   * 
   * AgentForge 接口: chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse>
   */
  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    const result = await generateText({
      model,
      messages: this.convertMessages(messages),
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? 4096,
    });

    // 转换结果为 AgentForge LLMResponse 格式
    const toolCalls = result.toolCalls?.map(tc => ({
      id: tc.toolCallId,
      name: tc.toolName,
      args: tc.args as Record<string, unknown>,
    }));

    return {
      content: result.text,
      toolCalls: toolCalls?.length > 0 ? toolCalls : undefined,
      finishReason: result.finishReason as 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled',
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
      },
    };
  }

  /**
   * 流式调用 - stream 方法
   * 
   * AgentForge 接口: stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk>
   * 
   * 注意: 返回类型是 Observable<LLMChunk>，不是 AsyncGenerator
   */
  stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk> {
    return new Observable<LLMChunk>((subscriber) => {
      const run = async () => {
        try {
          const stream = await streamText({
            model,
            messages: this.convertMessages(messages),
            temperature: options?.temperature ?? 0.7,
            maxTokens: options?.maxTokens ?? 4096,
          });

          // 流式输出文本块
          for await (const textChunk of stream.textStream) {
            if (textChunk) {
              subscriber.next({ text: textChunk });
            }
          }

          // 流式输出工具调用块
          for await (const chunk of stream.fullStream) {
            if (chunk.type === 'tool-call') {
              subscriber.next({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                argsDelta: JSON.stringify(chunk.args),
              });
            }
          }

          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      };

      run();
    });
  }
}

// ============================================================
// 示例 1: 基础对话
// ============================================================

async function example1_basicChat() {
  console.log('\n=== 示例 1: 基础对话 ===\n');

  if (!OPENAI_API_KEY) {
    console.log('⚠️  请设置 OPENAI_API_KEY 环境变量');
    console.log('   或使用 Mock 示例: npx tsx examples/01-basic-llm.ts');
    return;
  }

  const adapter = new AISDKAdapter();

  const config: AgentConfig = {
    name: 'chat-assistant',
    model: { provider: 'openai-compatible', model: MODEL_NAME },
    maxSteps: 5,
    preset: 'debug',
    llmAdapter: adapter,
    tools: [], // 无工具，纯对话
  };

  const agent = createAgent(config);

  console.log('发送消息: "你好，请简单介绍一下你自己"');

  try {
    const result = await agent.run('你好，请简单介绍一下你自己');
    console.log('\n响应结果:');
    console.log(result);
  } catch (error) {
    console.error('执行失败:', error);
  }
}

// ============================================================
// 示例 2: 带工具的 Agent
// ============================================================

async function example2_withTools() {
  console.log('\n=== 示例 2: 带工具的 Agent ===\n');

  if (!OPENAI_API_KEY) {
    console.log('⚠️  请设置 OPENAI_API_KEY 环境变量');
    return;
  }

  const adapter = new AISDKAdapter();

  // 定义简单工具 - 计算器
  const calculatorTool: ToolDefinition = {
    name: 'calculator',
    description: '执行简单的数学计算。输入数学表达式，返回计算结果。',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '数学表达式，如 "2 + 3 * 4"',
        },
      },
      required: ['expression'],
    },
  };

  const config: AgentConfig = {
    name: 'calculator-agent',
    model: { provider: 'openai-compatible', model: MODEL_NAME },
    maxSteps: 10,
    preset: 'debug',
    llmAdapter: adapter,
    tools: [calculatorTool],
  };

  const agent = createAgent(config);

  console.log('发送消息: "请帮我计算 15 * 7 + 22 的结果"');

  try {
    const result = await agent.run('请帮我计算 15 * 7 + 22 的结果');
    console.log('\n响应结果:');
    console.log(result);
  } catch (error) {
    console.error('执行失败:', error);
  }
}

// ============================================================
// 示例 3: 流式输出
// ============================================================

async function example3_streaming() {
  console.log('\n=== 示例 3: 流式输出 ===\n');

  if (!OPENAI_API_KEY) {
    console.log('⚠️  请设置 OPENAI_API_KEY 环境变量');
    return;
  }

  const adapter = new AISDKAdapter();

  const config: AgentConfig = {
    name: 'streaming-agent',
    model: { provider: 'openai-compatible', model: MODEL_NAME },
    maxSteps: 5,
    streaming: true,
    llmAdapter: adapter,
    tools: [],
  };

  const agent = createAgent(config);

  console.log('发送消息（流式）: "写一首关于人工智能的短诗"');
  console.log('\n流式响应:');

  try {
    await agent.stream('写一首关于人工智能的短诗', {
      onLLMStreamText: (text) => {
        process.stdout.write(text);
      },
      onComplete: (output) => {
        console.log('\n\n[完成] 最终输出:', output.substring(0, 100) + '...');
      },
      onError: (error) => {
        console.error('\n错误:', error);
      },
    });
  } catch (error) {
    console.error('执行失败:', error);
  }
}

// ============================================================
// 示例 4: 自定义 Provider（如 DeepSeek）
// ============================================================

function example4_customProvider() {
  console.log('\n=== 示例 4: 自定义 Provider ===\n');

  console.log('支持的 OpenAI-compatible Provider:');
  console.log('');
  console.log('1. OpenAI (默认)');
  console.log('   baseURL: https://api.openai.com/v1');
  console.log('   apiKey: OPENAI_API_KEY');
  console.log('');
  console.log('2. Azure OpenAI');
  console.log('   baseURL: https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT');
  console.log('   apiKey: AZURE_OPENAI_KEY');
  console.log('');
  console.log('3. Groq');
  console.log('   baseURL: https://api.groq.com/openai/v1');
  console.log('   apiKey: GROQ_API_KEY');
  console.log('');
  console.log('4. DeepSeek');
  console.log('   baseURL: https://api.deepseek.com/v1');
  console.log('   apiKey: DEEPSEEK_API_KEY');
  console.log('');
  console.log('5. Together AI');
  console.log('   baseURL: https://api.together.xyz/v1');
  console.log('   apiKey: TOGETHER_API_KEY');
  console.log('');
  console.log('使用方法:');
  console.log('  export OPENAI_BASE_URL=https://api.deepseek.com/v1');
  console.log('  export OPENAI_API_KEY=your-deepseek-key');
  console.log('  export MODEL_NAME=deepseek-chat');
  console.log('  npx tsx examples/05-real-llm.ts');
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   AgentForge 真实 LLM 示例 - AI SDK (Vercel)               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  console.log('\n配置信息:');
  console.log(`  Base URL: ${OPENAI_BASE_URL}`);
  console.log(`  Model: ${MODEL_NAME}`);
  console.log(`  API Key: ${OPENAI_API_KEY ? '已设置 ✓' : '未设置 ✗'}`);

  await example1_basicChat();
  await example2_withTools();
  await example3_streaming();
  example4_customProvider();

  console.log('\n✅ 示例完成');
}

main().catch(console.error);