import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export function createStdioTransport(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  }
) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
  }
  return new StdioClientTransport({
    command,
    args,
    cwd: options?.cwd || process.cwd(),
    env,
  });
}
