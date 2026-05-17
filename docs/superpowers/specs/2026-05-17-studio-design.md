# AgentForge Studio Design Spec

## Summary

Web-based observability and evaluation UI embedded into AgentForge Server. Provides real-time trace/span visualization, metrics dashboards, session management, and agent evaluation tooling. Built with Vue 3 + Vite, served as static assets from the server.

## Requirements

- **Positioning**: Developer debugging + production monitoring
- **Deployment**: Embedded into AgentForge Server (single process, zero extra config)
- **Data source**: Built-in only (EventBus, InMemoryMetrics, TraceCollector, SessionStorage)
- **Theming**: Dark/light dual theme with toggle
- **Tech stack**: Vue 3 + Vite + Pinia + TanStack Vue Query + ECharts + Tailwind CSS v4 + Radix Vue + shadcn-vue

## Architecture

```
packages/
  studio-ui/               ← @primo-ai/studio-ui (Vue 3 SPA)
    src/
      views/               ← Page components
      components/          ← Reusable UI components
      composables/         ← Vue composables (useTraces, useMetrics, etc.)
      stores/              ← Pinia stores (theme, filters, preferences)
      api/                 ← API client (ofetch-based)
      types/               ← TypeScript type definitions
    vite.config.ts
    tailwind.config.ts
    package.json

  server/ (existing)
    src/
      studio-routes.ts     ← Register studio API + serve static assets
      studio-api/
        traces.ts          ← Trace endpoints
        metrics.ts         ← Metrics endpoints
        sessions.ts        ← Session endpoints
        agents.ts          ← Agent list endpoint
        evals.ts           ← Evaluation endpoints (Phase 3)
```

### Data Flow

```
Pipeline execution
  → EventBus.emit(agent:start, stage:before, llm:after, tool:after, ...)
    → SessionPersistence → JSONL files (durable)
    → TraceCollector → in-memory span trees (volatile)
    → InMemoryMetrics → counters/gauges/histograms (volatile)

HTTP request to Studio API
  → studio-api handler reads from SessionStorage / TraceCollector / InMemoryMetrics
  → returns JSON

Vue SPA
  → ofetch API client → TanStack Vue Query cache → composable → component
```

### Dependency Direction

```
sdk (zero deps)
  ← observability (TraceCollector, InMemoryMetrics, OTelBridge)
  ← core (SessionStorage, EventBus, EventSystem)
  ← studio-ui (depends on server API at runtime)
  ← server (imports studio-api handlers, serves studio-ui dist/)
```

## API Design

### Trace Endpoints

```
GET /api/studio/traces
  Query: ?status=completed|running|error&agent=xxx&limit=50&offset=0&from=ISO&to=ISO
  Response: { traces: TraceSummary[], total: number }
  TraceSummary: { id, agentName, status, duration, tokenTotal, costEstimated, startTime }

GET /api/studio/traces/:id
  Response: { trace: TraceDetail }
  TraceDetail: { id, agentName, status, duration, rootSpan: SpanNode }
  SpanNode: { name, spanType, startTime, endTime, durationMs, attributes, events, children: SpanNode[] }
```

### Session Endpoints

```
GET /api/studio/sessions
  Query: ?status=active|completed|suspended|error&limit=50&offset=0
  Response: { sessions: SessionSummary[], total: number }
  SessionSummary: { id, agentName, status, createdAt, updatedAt, messageCount, parentSessionId }

GET /api/studio/sessions/:id
  Response: { session: SessionDetail }
  SessionDetail: { id, agentName, status, meta, events: SessionEvent[] }

GET /api/studio/sessions/:id/events
  Query: ?fromSeq=0&toSeq=100&types=llm:after,tool:after
  Response: { events: SessionEvent[] }
```

### Metrics Endpoints

```
GET /api/studio/metrics
  Response: MetricsSnapshot (from InMemoryMetrics.snapshot())

GET /api/studio/metrics/kpi
  Query: ?period=1h|6h|24h|7d
  Response: { totalRuns, avgLatency, totalTokens, estimatedCost, runsTrend, latencyTrend }
```

### Agent Endpoints

```
GET /api/studio/agents
  Response: { agents: AgentInfo[] }
  AgentInfo: { name, description, model, toolCount, lastRunAt }
```

### Evaluation Endpoints (Phase 3)

```
GET  /api/studio/experiments
POST /api/studio/experiments
GET  /api/studio/experiments/:id
GET  /api/studio/experiments/:id/results
GET  /api/studio/datasets
POST /api/studio/datasets
GET  /api/studio/scorers
POST /api/studio/scorers
```

## Routes and Pages

### P1 — Observability Core

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | KPI cards + recent traces table + mini charts |
| `/traces` | Trace List | Filterable table with status, agent, duration, tokens columns |
| `/traces/:id` | Trace Detail | Hierarchical span timeline (left) + span detail panel (right) |
| `/sessions` | Session List | Table with status filter, parent-child tree indicator |

### P2 — Monitoring Enhancement

| Route | Page | Description |
|-------|------|-------------|
| `/sessions/:id` | Session Detail | Session metadata + event stream + replay controls |
| `/metrics` | Metrics Dashboard | ECharts line/bar/pie charts with date range selector |

### P3 — Evaluation

| Route | Page | Description |
|-------|------|-------------|
| `/experiments` | Experiment List | Table with status, scorer count, dataset info |
| `/experiments/:id` | Experiment Detail | Run timeline + per-trace scores + scorer summary |
| `/datasets` | Dataset List | Datasets with item count, version, linked experiments |
| `/datasets/:id` | Dataset Detail | Items table + experiment comparison |
| `/scorers` | Scorer List | Scorer definitions + test results |

## Key Components

### SpanTimeline

- Renders hierarchical span bars on a proportional time axis
- Color-coded by span type: LLM (amber), tool (green), processor (violet), harness (teal)
- Collapsible iterations with iteration number header
- Click a span to select → detail panel updates
- Selected span highlighted with background tint

### KpiCard

- Title, value (large), trend indicator (up/down arrow + percentage vs previous period)
- Color: green (positive), yellow (warning), red (negative)

### MetricsChart

- ECharts wrapper supporting line, bar, pie, gauge types
- Date range selector with presets (1h, 6h, 24h, 7d, 30d, custom)
- Responsive, theme-aware (dark/light)

### SessionEventStream

- Chronological event list with type icons and timestamps
- Filter by event type (multi-select)
- Replay mode: step-forward through events, reconstructing context

### TraceList

- Sortable table columns: ID, agent, status (color dot), duration, tokens, time
- Row click → navigate to trace detail
- Batch filter: status, agent, date range

## Theming

CSS custom properties for seamless dark/light switching:

```css
:root {
  --bg-primary, --bg-secondary, --bg-tertiary
  --text-primary, --text-secondary, --text-muted
  --border, --border-hover
  --primary, --primary-hover
  --success, --warning, --error, --info
  --chart-1 through --chart-8 (for ECharts palette)
}

[data-theme="dark"] { /* dark overrides */ }
[data-theme="light"] { /* light overrides */ }
```

Tailwind v4 theme configured to reference these CSS variables. shadcn-vue components use the same token system.

## Real-time Updates (P2)

WebSocket endpoint at `/api/studio/ws` for live updates:

- Server pushes new trace started, trace completed, new events
- Client subscribes per page: trace detail page subscribes to specific trace, dashboard subscribes to global feed
- Graceful fallback: polling via Vue Query refetchInterval when WebSocket unavailable

## Build and Integration

```bash
# Build studio-ui as static assets
cd packages/studio-ui && pnpm build
# Output: packages/studio-ui/dist/ (index.html + assets)

# Server serves studio-ui
# In studio-routes.ts:
#   1. Register /api/studio/* routes
#   2. Serve packages/studio-ui/dist/ as static files at /
#   3. SPA fallback: unmatched routes serve index.html
```

Server CLI flag: `--studio` to enable the studio UI (disabled by default in production for security).

## Phasing Plan

### Phase 1 — Observability Core

1. Scaffold `packages/studio-ui/` with Vue 3 + Vite + Tailwind + Pinia + Vue Query
2. Create API client (`api/`) and TypeScript types (`types/`) matching existing data models
3. Implement `studio-api/traces.ts` — read from TraceCollector, build span trees
4. Implement `studio-api/sessions.ts` — read from SessionStorage
5. Implement `studio-api/metrics.ts` — read from InMemoryMetrics + compute KPIs
6. Implement `studio-api/agents.ts` — read from Agent registry
7. Create `studio-routes.ts` — register all routes + serve static assets
8. Build Dashboard page (KPI cards + recent traces)
9. Build Trace List page (sortable/filterable table)
10. Build Trace Detail page (SpanTimeline + SpanDetailPanel)
11. Build Session List page
12. Wire up theme toggle (dark/light)
13. Add `--studio` CLI flag to server

### Phase 2 — Monitoring Enhancement

1. Build Metrics page with ECharts (line charts for latency/token trends, pie for token distribution)
2. Build Session Detail page with event stream and replay
3. Add WebSocket server for live trace updates
4. Add advanced filtering (date range picker, multi-select filters)
5. Add trace comparison (side-by-side diff of two traces)

### Phase 3 — Evaluation

1. Define evaluation data model (Experiment, Dataset, Scorer, Result)
2. Implement evaluation storage (JSONL-based, similar to sessions)
3. Build Experiment CRUD UI (create with config, run, view results)
4. Build Scorer management (define scorer functions, test against sample data)
5. Build Dataset management (upload items, version, link to experiments)
6. Build evaluation comparison views (A/B trace scoring, scorer performance charts)

## Security Considerations

- Studio disabled by default; requires explicit `--studio` flag or config
- API routes under `/api/studio/` prefix for clear isolation
- No authentication in MVP (local dev only). Production auth is a future concern.
- Studio API is read-only for P1/P2 (no mutation of pipeline state)
- Evaluation write endpoints (P3) validate input strictly
