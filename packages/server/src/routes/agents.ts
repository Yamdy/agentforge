import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { ChatAgent } from '@agentforge/agents'
import { LLMProvider } from '@agentforge/llm'
import { Config } from '../config'

const app = new Hono()

const CreateAgentSchema = z.object({
  name: z.string(),
  systemPrompt: z.string().optional(),
  model: z.string().default(Config.llm.model),
  temperature: z.number().default(0.7)
})

const ChatSchema = z.object({
  message: z.string(),
  sessionId: z.string().optional()
})

app.post('/', zValidator('json', CreateAgentSchema), async (c) => {
  const data = c.req.valid('json')
  
  const llm = new LLMProvider({
    baseURL: Config.llm.baseURL,
    apiKey: Config.llm.apiKey,
    model: data.model,
    temperature: data.temperature
  })

  const agent = new ChatAgent({
    llm,
    systemPrompt: data.systemPrompt
  })

  return c.json({
    agentId: agent.id,
    name: data.name,
    model: data.model
  })
})

app.post('/:agentId/chat', zValidator('json', ChatSchema), async (c) => {
  const { agentId } = c.req.param()
  const { message, sessionId } = c.req.valid('json')

  // 这里可以从数据库加载agent配置
  const llm = new LLMProvider({
    baseURL: Config.llm.baseURL,
    apiKey: Config.llm.apiKey,
    model: Config.llm.model
  })

  const agent = new ChatAgent({ llm })

  const response = await agent.chat(message, { sessionId })

  return c.json({
    response: response.content,
    sessionId: response.sessionId,
    usage: response.usage
  })
})

export const agentRoutes = app
