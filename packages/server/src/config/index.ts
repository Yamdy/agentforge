import { z } from 'zod';

const ConfigSchema = z.object({
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),
  version: z.string().default('0.1.0'),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  allowedOrigins: z.string().transform(val => val.split(',')).default(['http://localhost:5173', 'http://localhost:3000']),
  jwtSecret: z.string().optional(),
  databaseUrl: z.string().optional(),
  redisUrl: z.string().optional(),
  llm: z.object({
    baseURL: z.string().default('https://api.openai.com/v1'),
    apiKey: z.string(),
    model: z.string().default('gpt-4o-mini'),
    temperature: z.coerce.number().default(0.7),
    maxTokens: z.coerce.number().default(2048),
  }).default({
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 2048,
  }),
});

export const Config = ConfigSchema.parse(process.env);
export type Config = z.infer<typeof ConfigSchema>;
