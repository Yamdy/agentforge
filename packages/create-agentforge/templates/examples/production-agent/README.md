# Production Agent

A production-ready agent with the full MPU (Minimum Production Usable) stack using AgentForge.

## Features

- **M1: SQLite Checkpoint** — Persistent state for pause/resume
- **M4: Circuit Breaker** — Resilience against LLM failures
- **M5: Audit Logging** — Full audit trail of all actions
- **M6: Tool Security** — Path validation and access control
- **M7: Cost Control** — Token usage tracking and quotas
- **M8: Observability** — Logging, tracing, and metrics
- **M9: Graceful Shutdown** — Clean termination on SIGTERM/SIGINT
- **M10: Result Validation** — Output schema validation

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
┌─────────────────────────────────────┐
│         Production Agent            │
├─────────────────────────────────────┤
│  L3 API (Observable control)       │
│  ┌─────────────────────────────┐   │
│  │  Observability Layer         │   │
│  │  (Logger + Tracer + Metrics)│   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Resilience Layer            │   │
│  │  (Circuit Breaker + Retry)  │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Security Layer              │   │
│  │  (Path validation + ACL)    │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Checkpoint Layer            │   │
│  │  (SQLite persistence)       │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

## Customization

- Adjust circuit breaker thresholds in `src/resilience/config.ts`
- Modify security policies in `src/security/policy.ts`
- Configure logging levels in `src/observability/logger.ts`
- Set token quotas in the config