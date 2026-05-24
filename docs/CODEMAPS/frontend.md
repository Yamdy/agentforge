<!-- Generated: 2026-05-24 | Files scanned: 18 | Token estimate: ~500 -->

# Frontend Architecture (Studio UI)

## Stack

Vue 3 + Vue Router + TailwindCSS, served from `/studio/` path.

## Routes

```
/                  → DashboardPage     (KPI cards, overview)
/traces            → TraceListPage     (trace listing)
/traces/:id        → TraceDetailPage   (span timeline)
/sessions          → SessionListPage   (session listing)
/permissions       → PermissionsPage   (pending approvals)
```

## Component Tree

```
App.vue
  └── AppLayout.vue (sidebar + main)
        ├── ThemeToggle.vue
        ├── KpiCard.vue
        └── SpanTimeline.vue
```

## Composables (Data Layer)

| Composable | API Module | Purpose |
|------------|-----------|---------|
| `useAgents()` | `api/agents.ts` | Agent list + status |
| `useSessions()` | `api/sessions.ts` | Session list + detail |
| `useTraces()` | `api/traces.ts` | Trace list + detail |
| `useMetrics()` | `api/metrics.ts` | Histogram + KPI data |
| `usePermissions()` | `api/permissions.ts` | Pending permission requests |

## State Management

No Vuex/Pinia. Each composable manages its own reactive state, fetching from `/api/studio/*` endpoints.

## Theme

`stores/theme.ts` — dark/light toggle persisted to localStorage.

## Types

`types/index.ts` — shared TypeScript interfaces for trace, span, session, and metric data.
