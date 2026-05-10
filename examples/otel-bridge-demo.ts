/**
 * OTel Bridge Demo — 用真实 LLM 测试 OTelBridge
 *
 * 展示 OTelBridge 如何将 pipeline 的 span 桥接到 OpenTelemetry：
 * - 配置 BasicTracerProvider + InMemorySpanExporter
 * - 将 OTelBridge 注入 Agent 作为 tracer
 * - 执行真实 LLM 调用
 * - 输出完整的 span 树
 *
 * 运行: npx tsx examples/otel-bridge-demo.ts
 */

import { Agent, registerProvider } from '@agentforge/core';
import { OTelBridge } from '@agentforge/observability';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

// ---------------------------------------------------------------------------
// 0. 注册 DeepSeek provider
// ---------------------------------------------------------------------------

registerProvider('deepseek', (modelId) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: 'sk-20717116e9be442f8e8ebb16d5a30f9a',
  });
  return sdk.languageModel(modelId);
});

// ---------------------------------------------------------------------------
// 1. 配置 OTel — InMemorySpanExporter 收集所有 span
// ---------------------------------------------------------------------------

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

// EventBus 订阅 span.end 事件，实时打印
const eventBus = {
  emit(eventType: string, data?: unknown) {
    if (eventType === 'span.end') {
      const d = data as { name: string; spanContext: { traceId: string; spanId: string } };
      console.log(`  [EventBus] span.end → ${d.name} (traceId: ${d.spanContext.traceId.slice(0, 8)}...)`);
    }
  },
};

// ---------------------------------------------------------------------------
// 2. 创建 OTelBridge + Agent
// ---------------------------------------------------------------------------

const tracer = new OTelBridge({ tracerProvider: provider, eventBus });

async function main() {
  console.log('=== OTel Bridge Demo ===\n');

  const agent = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: '你是一个简洁的助手。用一句话回答。',
    maxIterations: 1,
  }, { tracer });

  const query = '你是什么模型？用一句话回答。';
  console.log(`用户: ${query}\n`);

  let full = '';
  for await (const chunk of agent.stream(query)) {
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log('\n');

  // ---------------------------------------------------------------------------
  // 3. 刷新并打印 span 树
  // ---------------------------------------------------------------------------

  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();

  console.log(`\n=== Span Tree (${spans.length} spans) ===`);
  for (const span of spans) {
    const parentSpanCtx = (span as any).parentSpanContext as { spanId: string } | undefined;
    const indent = parentSpanCtx?.spanId ? '  └─ ' : '';
    const parentInfo = parentSpanCtx?.spanId
      ? ` (parent: ${parentSpanCtx.spanId.slice(0, 8)})`
      : ' (root)';
    const attrs = Object.entries(span.attributes)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log(`${indent}${span.name}${parentInfo} [${span.spanContext().spanId.slice(0, 8)}] ${attrs ? `{${attrs}}` : ''}`);
  }
  console.log(`\n--- 回复 ${full.length} 字符 ---`);
}

main().catch(console.error);
