/**
 * AgentForge 真实 LLM 示例 - 使用 AI SDK (Vercel AI SDK)
 *
 * 本示例展示如何使用真实 LLM 驱动 AgentForge 框架。
 * 使用 @ai-sdk/openai-compatible 适配器，支持任何 OpenAI-compatible API。
 *
 * 运行前准备:
 * 1. 安装依赖: npm install ai @ai-sdk/openai-compatible zod
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
 *
 * 新功能: model 字符串格式 (简化配置)
 * ─────────────────────────────────────────
 * 现在支持三种 model 配置方式:
 *
 * 1. 字符串格式 (推荐，最简单):
 *    model: "openai/gpt-4o"           // 指定 provider/model
 *    model: "gpt-4o"                  // 自动检测 provider
 *    model: "anthropic/claude-3-sonnet"
 *
 * 2. 对象格式 (向后兼容):
 *    model: { provider: 'openai', model: 'gpt-4o', apiKey: '...' }
 *
 * 3. 显式 llmAdapter (高级用户):
 *    llmAdapter: new MyCustomAdapter()
 */

import { generateText, streamText, tool } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Observable } from 'rxjs';
import { z } from 'zod';

// ============================================================
// 导入 AgentForge
// ============================================================

import { createAgent, type AgentConfig } from '../src/api/create-agent.js';
import type { AgentEvent, Message } from '../src/core/events.js';
import type { LLMAdapter, LLMResponse, LLMChunk, LLMOptions, ToolDefinition, FunctionDefinition } from '../src/core/interfaces.js';

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
   * 
   * AI SDK v6 的 ModelMessage 格式要求:
   * - system/user/assistant: { role, content }
   * - assistant with tool-call: { role: 'assistant', content: [{ type: 'tool-call', ... }] }
   * - tool: { role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName, output }] }
   * 
   * 重要: AI SDK 要求 tool 消息之前必须有包含 tool-call 的 assistant 消息
   * AgentForge 的 state.messages 不包含 assistant(tool-call)，需要在此补全
   */
  private convertMessages(messages: Message[]): Array<
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | Array<{ type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }> }
    | { role: 'tool'; content: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }> }
  > {
    const result: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string | unknown[];
    }> = [];
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
      
      // Tool 消息需要特殊处理
      if (msg.role === 'tool') {
        const toolMsg = msg as unknown as Record<string, unknown>;
        const toolCallId = (toolMsg['toolCallId'] as string) ?? '';
        const toolName = (toolMsg['name'] as string) ?? '';
        
        // 检查前一条消息是否是 assistant with tool-call
        // 如果不是，需要插入一个 assistant 消息
        const prevMsg = result[result.length - 1];
        const needsAssistant = !prevMsg || 
          prevMsg.role !== 'assistant' ||
          !Array.isArray(prevMsg.content) ||
          !(prevMsg.content as Array<unknown>).some(
            (c: unknown) => (c as { type?: string })?.type === 'tool-call'
          );
        
        if (needsAssistant) {
          // 插入 assistant 消息（包含 tool-call）
          result.push({
            role: 'assistant' as const,
            content: [{
              type: 'tool-call',
              toolCallId,
              toolName,
              args: {},  // AgentForge 不存储原始 args，用空对象
            }],
          });
        }
        
        // 添加 tool 消息
        result.push({
          role: 'tool' as const,
          content: [{
            type: 'tool-result',
            toolCallId,
            toolName,
            // AI SDK v6 要求 output 必须是 { type: 'text', value: string } 或 { type: 'json', value: unknown }
            output: { type: 'text' as const, value: content },
          }],
        });
      } else {
        // 其他角色 - 直接添加
        result.push({
          role: msg.role as 'system' | 'user' | 'assistant',
          content,
        });
      }
    }
    
    return result as Array<
      | { role: 'system'; content: string }
      | { role: 'user'; content: string }
      | { role: 'assistant'; content: string | Array<{ type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }> }
      | { role: 'tool'; content: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }> }
    >;
  }

  /**
   * 将 AgentForge FunctionDefinition[] 转换为 AI SDK tools 格式
   * 
   * AI SDK tools 格式: { toolName: { description, parameters, execute } }
   * 注意: AI SDK 需要 execute 函数来执行工具，但 AgentForge 的工具执行由框架处理
   * 这里我们只传递工具定义给 LLM，工具执行由 AgentForge 的 ToolRegistry 处理
   */
  private convertTools(tools: FunctionDefinition[] | undefined): Record<string, ReturnType<typeof tool>> | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    const result: Record<string, ReturnType<typeof tool>> = {};
    for (const t of tools) {
      // 将 JSON Schema properties 转换为 Zod schema
      const properties = t.parameters.properties as Record<string, z.ZodTypeAny>;
      const required = t.parameters.required ?? [];
      
      // 构建 Zod object schema
      const schemaShape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(properties)) {
        const propDef = prop as { type?: string; description?: string };
        let zodType: z.ZodTypeAny;
        
        // 根据 JSON Schema type 转换为 Zod type
        switch (propDef.type) {
          case 'string':
            zodType = z.string().describe(propDef.description ?? '');
            break;
          case 'number':
            zodType = z.number().describe(propDef.description ?? '');
            break;
          case 'boolean':
            zodType = z.boolean().describe(propDef.description ?? '');
            break;
          case 'array':
            zodType = z.array(z.unknown()).describe(propDef.description ?? '');
            break;
          case 'object':
            zodType = z.record(z.unknown()).describe(propDef.description ?? '');
            break;
          default:
            zodType = z.unknown().describe(propDef.description ?? '');
        }
        
        // 如果不是必需的，设为可选
        if (!required.includes(key)) {
          zodType = zodType.optional();
        }
        
        schemaShape[key] = zodType;
      }
      
      result[t.name] = tool({
        description: t.description,
        parameters: z.object(schemaShape),
        // execute 由 AgentForge 框架处理，这里返回占位符
        execute: async (args: unknown) => {
          // 工具执行由 AgentForge 的 ToolRegistry 处理
          // 这个 execute 不会被调用，因为 AgentForge 会拦截工具调用
          return JSON.stringify(args);
        },
      });
    }
    return result;
  }

  /**
   * 非流式调用 - chat 方法
   * 
   * AgentForge 接口: chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse>
   */
  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    // 转换工具定义
    const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
    
    // 转换消息 - 补全 AI SDK 要求的消息格式
    const convertedMessages = this.convertMessages(messages);
    
    const result = await generateText({
      model,
      messages: convertedMessages,
      temperature: options?.temperature ?? 0.7,
      ...(tools ? { tools } : {}),
    });

    // 转换结果为 AgentForge LLMResponse 格式
    // AI SDK v5+ uses 'input' property for tool call arguments (renamed from 'args')
    const toolCalls = result.toolCalls?.map(tc => ({
      id: tc.toolCallId,
      name: tc.toolName,
      args: (tc as { input?: Record<string, unknown> }).input ?? {},
    }));

    return {
      content: result.text,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: result.finishReason as 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled',
      usage: result.usage ? {
        promptTokens: (result.usage as { promptTokens?: number }).promptTokens ?? 0,
        completionTokens: (result.usage as { completionTokens?: number }).completionTokens ?? 0,
      } : undefined,
    };
  }

  /**
   * 流式调用 - stream 方法
   * 
   * AgentForge 接口: stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk>
   * 
   * 注意: 返回类型是 Observable<LLMChunk>，不是 AsyncGenerator
   * 
   * 使用 fullStream 以确保文本和工具调用块的正确顺序
   */
  stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk> {
    return new Observable<LLMChunk>((subscriber) => {
      const run = async () => {
        try {
          // 转换工具定义
          const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
          
          // 使用 fullStream 以获得所有块类型（包括文本和工具调用）
          const { fullStream } = await streamText({
            model,
            messages: this.convertMessages(messages),
            temperature: options?.temperature ?? 0.7,
            ...(tools ? { tools } : {}),
          });

          // 从 fullStream 迭代，保持正确的块顺序
          for await (const chunk of fullStream) {
            if (chunk.type === 'text-delta') {
              // 文本块 - AI SDK uses 'text' property for text-delta chunks
              const textDelta = (chunk as { text?: string }).text;
              if (textDelta) {
                subscriber.next({ text: textDelta });
              }
            } else if (chunk.type === 'tool-call') {
              // 工具调用块 - AI SDK uses 'input' property for args
              const toolCallChunk = chunk as {
                toolCallId: string;
                toolName: string;
                input?: unknown;
              };
              subscriber.next({
                toolCallId: toolCallChunk.toolCallId,
                toolName: toolCallChunk.toolName,
                argsDelta: JSON.stringify(toolCallChunk.input ?? {}),
              });
            }
            // 其他块类型（如 tool-call-delta）可以按需处理
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
// 示例 1b: 简化字符串 model 格式 (新功能)
// ============================================================

async function example1b_stringModelFormat() {
  console.log('\n=== 示例 1b: 简化字符串 model 格式 ===\n');

  if (!OPENAI_API_KEY) {
    console.log('⚠️  请设置 OPENAI_API_KEY 环境变量');
    return;
  }

  // 新功能: 使用字符串格式指定 model
  // 支持格式:
  //   "provider/model" - 如 "openai/gpt-4o", "anthropic/claude-3-sonnet"
  //   "model"          - 自动检测 provider，如 "gpt-4o" → "openai"
  //
  // 注意: 当前为 stub 实现，需要先注册真实的 adapter 工厂
  // 完整实现需要安装 @ai-sdk/openai 等包并注册工厂

  const config: AgentConfig = {
    name: 'simple-agent',
    model: 'gpt-4o-mini',  // 字符串格式 - 自动检测为 openai
    // 或者显式指定:
    // model: 'openai/gpt-4o-mini',
    // model: 'anthropic/claude-3-sonnet',
    // model: 'deepseek/deepseek-chat',
    maxSteps: 5,

    // 可选: 通过 llmOptions 传递额外配置
    llmOptions: {
      apiKey: OPENAI_API_KEY,
      baseURL: OPENAI_BASE_URL,
    },
  };

  console.log('使用字符串 model 格式:');
  console.log(`  model: "${config.model}"`);
  console.log('  llmOptions: { apiKey, baseURL }');
  console.log('\n注意: 当前为 stub 实现，需要注册真实 adapter');
  console.log('请参见 example1_basicChat() 使用显式 adapter');

  // 完整实现时的用法:
  // const agent = createAgent(config);
  // const result = await agent.run('你好');
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
  // 注意: ToolDefinition 需要包含 execute 函数
  const calculatorTool: ToolDefinition = {
    name: 'calculator',
    description: '执行简单的数学计算。输入数学表达式，返回计算结果。例如: "2 + 3 * 4"',
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
    execute: async (args: unknown) => {
      const { expression } = args as { expression: string };
      try {
        // 使用 Function 构造函数安全地计算表达式
        // 注意: 生产环境应使用更安全的表达式解析库
        const result = Function('"use strict"; return (' + expression + ')')();
        return String(result);
      } catch {
        return '计算错误：无法解析表达式';
      }
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
      onText: (delta) => {
        // Stream text chunks in real-time
        process.stdout.write(delta);
      },
      onEvent: (event) => {
        // Optional: log all events for debugging
        if (event.type === 'llm.stream.start') {
          console.log('\n[流式开始]');
        } else if (event.type === 'llm.stream.end') {
          console.log('\n[流式结束]');
        }
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
  example1b_stringModelFormat();  // 展示新功能
  await example2_withTools();
  await example3_streaming();
  example4_customProvider();

  console.log('\n✅ 示例完成');
}

main().catch(console.error);
