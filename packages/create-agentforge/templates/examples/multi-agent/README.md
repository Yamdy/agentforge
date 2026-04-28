# Multi-Agent

An orchestrator + worker pattern with subagents using AgentForge.

## Features

- Orchestrator agent that coordinates specialized workers
- Research, writing, and review sub-agents
- Task delegation with Zod-validated parameters
- Workflow coordination and result synthesis

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

## Architecture

```
Orchestrator Agent
├── Researcher Agent  — Gathers information on topics
├── Writer Agent     — Creates content based on research
└── Reviewer Agent   — Checks quality and accuracy
```

The orchestrator breaks down tasks and delegates to workers,
then synthesizes their outputs into a final result.

## Customization

- Add new worker agents in `src/agents/`
- Modify the orchestrator's system prompt to change delegation behavior
- Add more delegation tools for new worker types
- Adjust `maxSteps` for longer workflows