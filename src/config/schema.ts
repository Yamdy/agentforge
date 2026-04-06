import { z } from 'zod';

export const ServerConfigSchema = z.object({
  port: z.number().default(3000),
  apiKey: z.string().optional(),
  corsOrigins: z.union([z.string(), z.array(z.string())]).default('*'),
  compactionThreshold: z.number().default(20),
  compactionEnabled: z.boolean().default(true),
});

export const AgentConfigSchema = z.object({
  model: z.string().default('gpt-4-turbo'),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  maxSteps: z.number().default(Infinity),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
