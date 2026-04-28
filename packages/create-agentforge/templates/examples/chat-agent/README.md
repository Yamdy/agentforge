# Chat Agent

A simple conversational agent with memory using AgentForge.

## Features

- Multi-turn conversation with automatic history management
- Streaming responses for real-time output
- Minimal configuration — just set your API key and go

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

- Edit `agentforge.config.ts` to change the agent's name, model, or system prompt
- Modify `src/index.ts` to add custom conversation flows
- Add tools by importing them in the config

## API Modes

This template uses the **L2 (simple)** API by default. To switch to the L3 (advanced) API with full Observable control, see the AgentForge documentation.