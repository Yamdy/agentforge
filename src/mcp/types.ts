import { z } from 'zod';

export const McpLocalConfigSchema = z.object({
  type: z.literal('local'),
  command: z.array(z.string()).min(1, 'Command is required'),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
  timeout: z.number().int().positive().optional(),
});
export type McpLocalConfig = z.infer<typeof McpLocalConfigSchema>;

export const OAuthConfigSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
});
export type OAuthConfig = z.infer<typeof OAuthConfigSchema>;

export const McpRemoteConfigSchema = z.object({
  type: z.literal('remote'),
  url: z.string().url('Invalid URL format'),
  headers: z.record(z.string()).optional(),
  oauth: z.union([z.boolean(), OAuthConfigSchema]).default(true),
  enabled: z.boolean().default(true),
  timeout: z.number().int().positive().optional(),
});
export type McpRemoteConfig = z.infer<typeof McpRemoteConfigSchema>;

export const McpServerConfigSchema = z.discriminatedUnion('type', [
  McpLocalConfigSchema,
  McpRemoteConfigSchema,
]);
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('connected') }),
  z.object({ status: z.literal('disabled') }),
  z.object({ status: z.literal('failed'), error: z.string() }),
  z.object({ status: z.literal('needs_auth') }),
  z.object({ status: z.literal('needs_client_registration'), error: z.string() }),
]);
export type McpStatus = z.infer<typeof McpStatusSchema>;

export type AuthStatus = 'authenticated' | 'expired' | 'not_authenticated';

export interface McpResource {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
  client: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
  client: string;
}

export const schemas = {
  McpLocalConfig: McpLocalConfigSchema,
  McpRemoteConfig: McpRemoteConfigSchema,
  McpServerConfig: McpServerConfigSchema,
  McpStatus: McpStatusSchema,
} as const;
