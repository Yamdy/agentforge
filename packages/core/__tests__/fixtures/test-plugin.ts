import type { HarnessAPI, PluginRegistration, Processor, Tool } from '@primo-ai/sdk';
import { z } from 'zod';

const stageLogger: Processor = {
  stage: 'processInput',
  execute: async () => {},
};

const pingTool: Tool<{ message: string }, string> = {
  name: 'ping',
  description: 'Returns pong + message',
  inputSchema: z.object({ message: z.string() }),
  execute: async ({ message }) => `pong: ${message}`,
};

export default function testPlugin(api: HarnessAPI): PluginRegistration {
  api.registerProcessor('processInput', stageLogger);
  api.registerTool(pingTool as Tool);
  return { processors: [stageLogger], tools: [pingTool as Tool] };
}
