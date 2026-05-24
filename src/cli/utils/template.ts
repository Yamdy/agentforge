export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

export const TEMPLATES = {
  index: `
import { createApp, startServer } from 'agentforge';

const app = createApp();

startServer(app, { port: 4111 });
`,
  config: `
import { defineConfig } from 'agentforge';

export default defineConfig({
  model: {
    provider: '{{provider}}',
    name: '{{modelName}}',
  },
});
`,
  exampleAgent: `
import { createAgent } from 'agentforge';

export const exampleAgent = createAgent({
  name: 'Example Agent',
  description: 'A simple example agent',
  systemPrompt: 'You are a helpful assistant.',
});
`,
  gitignore: `
node_modules
dist
.agentforge
.env
*.log
`,
};
