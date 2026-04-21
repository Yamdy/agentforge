import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ChatAgent } from '@agentforge/agents';
import { OpenAICompatibleProvider, LLMError } from '@agentforge/llm';
import { InMemorySessionManager } from '@agentforge/memory';
import { Config } from './config';

const app = new Hono();

// 全局中间件
app.use('*', cors({
  origin: Config.allowedOrigins,
  credentials: true,
}));

// 健康检查
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    version: Config.version,
    environment: Config.environment,
    timestamp: Date.now(),
  });
});

// 聊天接口
const ChatSchema = z.object({
  message: z.string(),
  sessionId: z.string().optional(),
  model: z.string().default(Config.llm.model),
  temperature: z.number().default(Config.llm.temperature),
  apiKey: z.string().optional(),
});

const sessionManager = new InMemorySessionManager();

app.post('/api/chat', zValidator('json', ChatSchema), async (c) => {
  const { message, sessionId, model, temperature, apiKey } = c.req.valid('json');
  
  try {
    const llmProvider = new OpenAICompatibleProvider({
      baseURL: Config.llm.baseURL,
      apiKey: apiKey || Config.llm.apiKey,
      model,
      temperature,
    });

    const agent = new ChatAgent({
      llmProvider,
      sessionManager,
      systemPrompt: '你是一个乐于助人的助手，回答简洁明了。',
    });

    const result = await agent.chat(message, { sessionId });

    return c.json({
      response: result.response,
      sessionId: result.sessionId,
      // usage: result.usage, // 暂未实现
    });
  } catch (e) {
    const err = e as LLMError;
    return c.json({ error: err.message }, 500);
  }
});

// 404
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// 错误处理
app.onError((err, c) => {
  return c.json({ error: err.message }, 500);
});

// 启动服务
const port = Config.port || 3000;
console.log(`🚀 AgentForge serve running on http://0.0.0.0:${port}`);
console.log(`📖 Health check: http://localhost:${port}/health`);

serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0',
});
