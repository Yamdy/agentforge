import { Hono } from 'hono';
import type { AgentRegistry } from '../../registry.js';
import type { SelfModificationEngineContext } from '@primo-ai/core';

// ---------------------------------------------------------------------------
// Types for API responses
// ---------------------------------------------------------------------------

interface ConstitutionResponse {
  version: number;
  protectedPaths: Array<{ pattern: string; reason: string; level: string }>;
  diffLimits: Record<string, number>;
  approvalMatrix: Record<string, { description: string; mode: string }>;
}

interface BudgetResponse {
  state: {
    hourlyCount: number;
    dailyCount: number;
    hourlyResetAt: number;
    dailyResetAt: number;
    lastMutationAt: number;
  };
  config: {
    maxMutationsPerHour: number;
    maxMutationsPerDay: number;
    maxFilesPerMutation: number;
    maxDiffLinesPerMutation: number;
    cooldownMs: number;
  };
}

interface WatchdogResponse {
  state: {
    consecutiveFailures: number;
    lastHealthySnapshot: string;
    lastCheckTime: string;
    totalRollbacks: number;
  };
  healthChecks: Array<{ name: string }>;
}

interface VerifyRequest {
  diff: Array<{ path: string; content?: string }>;
  riskLevel?: string;
}

interface VerifyResponse {
  overall: 'passed' | 'failed';
  gates: Array<{
    gate: string;
    passed: boolean;
    duration: number;
    errors?: string[];
    protectionLevel?: string;
  }>;
  timestamp: string;
}

interface AuditLogEntry {
  id: string;
  riskLevel: string;
  accepted: boolean;
  reason?: string;
  timestamp: string;
}

interface SelfModificationListResponse {
  agents: Array<{
    id: string;
    hasEngine: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEngineContext(registry: AgentRegistry, agentId: string): SelfModificationEngineContext | null {
  const agent = registry.get(agentId);
  if (!agent) return null;
  try {
    return (agent as unknown as { engineContext: SelfModificationEngineContext }).engineContext ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface SelfModificationRouteOptions {
  registry: AgentRegistry;
}

export function selfModificationRoutes(opts: SelfModificationRouteOptions): Hono {
  const app = new Hono();

  // List agents with self-modification capability
  app.get('/', (c) => {
    const entries = opts.registry.list();
    const agents: SelfModificationListResponse['agents'] = entries.map((e) => ({
      id: e.id,
      hasEngine: getEngineContext(opts.registry, e.id) !== null,
    }));
    return c.json({ agents });
  });

  // GET constitution
  app.get('/:agentId/constitution', (c) => {
    const ctx = getEngineContext(opts.registry, c.req.param('agentId'));
    if (!ctx) return c.json({ error: 'Agent not found or no self-modification engine' }, 404);

    const constitution = ctx.constitutionEngine.constitution;
    const response: ConstitutionResponse = {
      version: constitution.version,
      protectedPaths: constitution.protectedPaths.map((p) => ({
        pattern: p.pattern,
        reason: p.reason,
        level: p.level,
      })),
      diffLimits: constitution.diffLimits as unknown as Record<string, number>,
      approvalMatrix: Object.fromEntries(
        Object.entries(constitution.approvalMatrix).map(([k, v]) => [
          k,
          { description: v.description, mode: v.mode },
        ]),
      ),
    };
    return c.json(response);
  });

  // POST verify — run verification gate pipeline
  app.post('/:agentId/verify', async (c) => {
    const ctx = getEngineContext(opts.registry, c.req.param('agentId'));
    if (!ctx) return c.json({ error: 'Agent not found or no self-modification engine' }, 404);

    let body: VerifyRequest;
    try {
      body = await c.req.json<VerifyRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.diff || !Array.isArray(body.diff)) {
      return c.json({ error: 'diff array is required' }, 400);
    }

    const patches = body.diff.map((d) => ({
      path: d.path,
      content: d.content ?? '',
      type: 'modified' as const,
    }));

    const constitution = ctx.constitutionEngine.constitution;
    const report = await ctx.gatePipeline.execute(patches, {
      constitution,
      snapshotId: '',
      agentId: c.req.param('agentId'),
    });

    const response: VerifyResponse = {
      overall: report.overall,
      gates: report.gates.map((g) => ({
        gate: g.passed ? 'unknown' : g.gate,
        passed: g.passed,
        duration: g.duration,
        errors: g.passed ? undefined : g.errors,
        protectionLevel: g.passed ? undefined : g.protectionLevel,
      })),
      timestamp: report.timestamp,
    };
    return c.json(response);
  });

  // GET mutation budget status
  app.get('/:agentId/budget', (c) => {
    const ctx = getEngineContext(opts.registry, c.req.param('agentId'));
    if (!ctx) return c.json({ error: 'Agent not found or no self-modification engine' }, 404);

    const state = ctx.budgetEngine.state;
    const budgetOpts = ctx.budgetEngine.options;

    const response: BudgetResponse = {
      state: {
        hourlyCount: state.hourlyCount,
        dailyCount: state.dailyCount,
        hourlyResetAt: state.hourlyResetAt,
        dailyResetAt: state.dailyResetAt,
        lastMutationAt: state.lastMutationAt,
      },
      config: {
        maxMutationsPerHour: budgetOpts.maxMutationsPerHour,
        maxMutationsPerDay: budgetOpts.maxMutationsPerDay,
        maxFilesPerMutation: budgetOpts.maxFilesPerMutation,
        maxDiffLinesPerMutation: budgetOpts.maxDiffLinesPerMutation,
        cooldownMs: budgetOpts.cooldownMs,
      },
    };
    return c.json(response);
  });

  // GET watchdog status
  app.get('/:agentId/watchdog', (c) => {
    const ctx = getEngineContext(opts.registry, c.req.param('agentId'));
    if (!ctx) return c.json({ error: 'Agent not found or no self-modification engine' }, 404);

    const constitution = ctx.constitutionEngine.constitution;

    const response: WatchdogResponse = {
      state: {
        consecutiveFailures: 0,
        lastHealthySnapshot: '',
        lastCheckTime: new Date().toISOString(),
        totalRollbacks: 0,
      },
      healthChecks: constitution.benchmarkFiles.map((f) => ({ name: f })),
    };
    return c.json(response);
  });

  // GET audit log
  app.get('/:agentId/audit', (c) => {
    const ctx = getEngineContext(opts.registry, c.req.param('agentId'));
    if (!ctx) return c.json({ error: 'Agent not found or no self-modification engine' }, 404);

    const entries: AuditLogEntry[] = [];
    return c.json({ entries });
  });

  return app;
}
