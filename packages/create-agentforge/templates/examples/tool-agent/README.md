# Tool Agent

An agent with custom tools and filesystem access using AgentForge.

## Features

- Custom Zod-validated tools (readFile, writeFile, listDir)
- Filesystem access for reading, writing, and listing files
- Tool calling with automatic schema generation
- Streaming responses

## Setup

1. Copy `.env.example` to `.env` and add your API key:

```bash
cp .env.example .env
# Edit .env with your OPENAI_API_KEY
```

2. Install dependencies:

```bash
npm install
```

3. Run the agent:

```bash
npm run dev
```

## Customization

- Add new tools in `agentforge.config.ts` under the `tools` key
- Each tool needs a `description`, `parameters` (Zod schema), and `execute` function
- The agent automatically generates function definitions from your Zod schemas

## Adding Tools

```typescript
tools: {
  myTool: {
    description: 'What this tool does',
    parameters: z.object({
      input: z.string().describe('Description of the input'),
    }),
    execute: async (args) => {
      // Your tool logic here
      return result;
    },
  },
}
```