import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { Effect } from 'effect'
import { ChatAgent } from '@agentforge/agents'
import { OpenAICompatibleProvider } from '@agentforge/llm'
import { InMemorySessionManager } from '@agentforge/memory'
import { Config } from '../config'

const app = new Hono()

const sessionManager = new InMemorySessionManager()

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
  
  const llm = new OpenAICompatibleProvider({
    baseURL: Config.llm.baseURL,
    apiKey: Config.llm.apiKey,
    model: data.model,
    temperature: data.temperature
  })

  const agent = await ChatAgent.create({
    llmProvider: llm,
    sessionManager,
    systemPrompt: data.systemPrompt
  })

  return c.json({
    name: data.name,
    model: data.model
  })
})

app.post('/:agentId/chat', zValidator('json', ChatSchema), async (c) => {
  const { message, sessionId } = c.req.valid('json')

  const llm = new OpenAICompatibleProvider({
    baseURL: Config.llm.baseURL,
    apiKey: Config.llm.apiKey,
    model: Config.llm.model
  })

  const agent = await ChatAgent.create({ 
    llmProvider: llm,
    sessionManager
  })

  const response = await Effect.runPromise(agent.sendMessage(message))

  return c.json({
    response
  })
})

export const agentRoutes = app
