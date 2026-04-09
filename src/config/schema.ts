import { z } from 'zod';

export const ModelConfigSchema = z.object({
  model: z.string().default('gpt-4-turbo'),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
});

export const ServerConfigSchema = z.object({
  port: z.number().default(3000),
  apiKey: z.string().optional(),
  corsOrigins: z.union([z.string(), z.array(z.string())]).default('*'),
  compactionThreshold: z.number().default(20),
  compactionEnabled: z.boolean().default(true),
  enableCors: z.boolean().default(true),
  rateLimit: z
    .object({
      enabled: z.boolean().default(false),
      maxRequests: z.number().default(100),
      windowMs: z.number().default(60000),
    })
    .optional(),
  auth: z
    .object({
      enabled: z.boolean().default(false),
      apiKeys: z.array(z.string()).default([]),
    })
    .optional(),
});

export const ToolConfigSchema = z.object({
  enabled: z.boolean().default(true),
  name: z.string(),
  description: z.string().optional(),
});

export const PluginConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.any()).optional(),
});

export const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  model: z.string().default('gpt-4-turbo'),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  maxSteps: z.number().default(10),
  systemPrompt: z.string().optional(),
  tools: z
    .array(z.union([z.string(), ToolConfigSchema]))
    .optional()
    .default([]),
  plugins: z.array(PluginConfigSchema).optional().default([]),
  middleware: z.array(z.string()).optional().default([]),
  memory: z
    .object({
      enabled: z.boolean().default(true),
      maxMessages: z.number().default(100),
    })
    .optional(),
});

export const PrimoConfigSchema = z.object({
  name: z.string(),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  agent: AgentConfigSchema,
  model: ModelConfigSchema.optional(),
  server: ServerConfigSchema.optional(),
  environment: z.enum(['development', 'production', 'test']).default('development'),
  logging: z
    .object({
      level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      enabled: z.boolean().default(true),
    })
    .optional(),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type PrimoConfig = z.infer<typeof PrimoConfigSchema>;
