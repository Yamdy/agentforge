/**
 * Weather Agent 示例
 *
 * 展示 @agentforge/core 的核心能力：
 * - 工具定义与注册（Zod schema）
 * - 自定义 Processor（buildContext 注入、processStepOutput guardrail）
 * - 流式输出
 * - Agentic loop 自动循环
 * - DeepSeek provider（OpenAI 兼容接口）
 *
 * 运行: npx tsx examples/weather-agent.ts
 */

import { Agent, registerProvider } from '@agentforge/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Tool, PipelineContext } from '@agentforge/sdk';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 0. 注册 DeepSeek provider（OpenAI 兼容）
// ---------------------------------------------------------------------------

registerProvider('deepseek', (modelId) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: 'sk-20717116e9be442f8e8ebb16d5a30f9a',
  });
  return sdk.languageModel(modelId);
});

// ---------------------------------------------------------------------------
// 1. 定义工具 — 查询天气
// ---------------------------------------------------------------------------

const getWeatherTool: Tool<{ city: string }, string> = {
  name: 'getWeather',
  description: '获取指定城市的当前天气信息',
  inputSchema: z.object({ city: z.string().describe('城市名称') }),
  execute: async ({ city }) => {
    const data: Record<string, { temp: number; condition: string; humidity: number }> = {
      '北京': { temp: 22, condition: '晴', humidity: 45 },
      '上海': { temp: 26, condition: '多云', humidity: 72 },
      '东京': { temp: 19, condition: '小雨', humidity: 80 },
      '纽约': { temp: 15, condition: '阴', humidity: 60 },
    };

    const weather = data[city];
    if (!weather) {
      return `${city}：暂无天气数据。可查询：北京、上海、东京、纽约`;
    }

    return `${city}：${weather.condition}，气温 ${weather.temp}°C，湿度 ${weather.humidity}%`;
  },
};

// ---------------------------------------------------------------------------
// 2. 定义工具 — 旅行建议
// ---------------------------------------------------------------------------

const getTravelAdviceTool: Tool<{ city: string; weather: string }, string> = {
  name: 'getTravelAdvice',
  description: '根据城市和天气情况给出旅行建议',
  inputSchema: z.object({
    city: z.string().describe('城市名称'),
    weather: z.string().describe('当前天气描述'),
  }),
  execute: async ({ city, weather }) => {
    const advice: Record<string, string> = {
      '晴': '天气晴好，适合户外活动和拍照。建议涂防晒霜。',
      '多云': '天气舒适，适合逛街和游览景点。',
      '小雨': '记得带伞，推荐室内活动如博物馆、咖啡馆。',
      '阴': '适合城市漫步，不会太晒也不会太热。',
    };

    for (const [key, tip] of Object.entries(advice)) {
      if (weather.includes(key)) return `${city}旅行建议：${tip}`;
    }
    return `${city}旅行建议：出行前查看最新天气预报。`;
  },
};

// ---------------------------------------------------------------------------
// 3. 注册自定义 Processor
// ---------------------------------------------------------------------------

function withMonitoring(agent: Agent): void {
  // processStepOutput: 输出质量检查
  agent.use({
    stage: 'processStepOutput',
    execute: async (ctx) => {
      const response = ctx.pipeline.response as string | undefined;
      if (response && response.length > 1000) {
        console.log('[Guardrail] 输出超过 1000 字，建议压缩');
      }
      return ctx;
    },
  });

  // evaluateIteration: 追踪迭代
  agent.use({
    stage: 'evaluateIteration',
    execute: async (ctx) => {
      console.log(`[Loop] 第 ${ctx.iteration.step + 1} 轮完成`);
      return ctx;
    },
  });
}

// ---------------------------------------------------------------------------
// 4. 创建并运行 Agent
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== AgentForge 天气助手 ===\n');

  const agent = new Agent({
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: [
      '你是一个天气旅行助手。用中文回答，每句话结尾带嘎嘎。',
      '当用户问天气时，调用 getWeather 查询。',
      '拿到天气后，调用 getTravelAdvice 获取建议。',
      '最后综合天气和建议，给出完整的出行推荐。',
    ].join('\n'),
    tools: [getWeatherTool, getTravelAdviceTool],
    maxIterations: 5,
  });

  withMonitoring(agent);

  const query = '你是什么模型';
  console.log(`用户: ${query}\n`);
  console.log('助手: ');

  let full = '';
  for await (const chunk of agent.stream(query)) {
    process.stdout.write(chunk);
    full += chunk;
  }

  console.log('\n');
  console.log(`--- 回复 ${full.length} 字符 ---`);
}

main().catch(console.error);
