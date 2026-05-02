/**
 * AgentForge Benchmark Framework
 *
 * Standardized benchmarks for comparing agent framework performance.
 * Run with: npx tsx benchmarks/run.ts
 */

import { performance } from 'perf_hooks';

// ============================================================
// Types
// ============================================================

export interface BenchmarkResult {
  name: string;
  framework: string;
  iterations: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  throughputOpsPerSec: number;
  memoryUsageMB: number;
  timestamp: string;
}

export interface BenchmarkScenario {
  name: string;
  description: string;
  setup: () => Promise<void>;
  run: () => Promise<void>;
  teardown: () => Promise<void>;
  iterations?: number;
  warmupIterations?: number;
}

export interface ComparisonTable {
  scenarios: string[];
  frameworks: Record<string, Record<string, BenchmarkResult>>;
  generatedAt: string;
}

// ============================================================
// Benchmark Runner
// ============================================================

export class BenchmarkRunner {
  private results: BenchmarkResult[] = [];

  async runScenario(
    scenario: BenchmarkScenario,
    framework: string,
    iterations?: number
  ): Promise<BenchmarkResult> {
    const iters = iterations ?? scenario.iterations ?? 100;
    const warmup = scenario.warmupIterations ?? 10;

    console.log(`\n[Benchmark] ${scenario.name} (${framework})`);
    console.log(`  Warmup: ${warmup} iterations`);
    console.log(`  Run: ${iters} iterations`);

    // Setup
    await scenario.setup();

    // Warmup
    for (let i = 0; i < warmup; i++) {
      await scenario.run();
    }

    // Measure memory before
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;

    // Run benchmarks
    const latencies: number[] = [];
    for (let i = 0; i < iters; i++) {
      const start = performance.now();
      await scenario.run();
      const end = performance.now();
      latencies.push(end - start);
    }

    // Measure memory after
    const memAfter = process.memoryUsage().heapUsed;
    const memoryDeltaMB = Math.max(0, (memAfter - memBefore) / 1024 / 1024);

    // Teardown
    await scenario.teardown();

    // Calculate statistics
    latencies.sort((a, b) => a - b);
    const result: BenchmarkResult = {
      name: scenario.name,
      framework,
      iterations: iters,
      avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      p99LatencyMs: percentile(latencies, 99),
      minLatencyMs: latencies[0],
      maxLatencyMs: latencies[latencies.length - 1],
      throughputOpsPerSec: 1000 / (latencies.reduce((a, b) => a + b, 0) / latencies.length),
      memoryUsageMB: memoryDeltaMB,
      timestamp: new Date().toISOString(),
    };

    this.results.push(result);
    this.printResult(result);
    return result;
  }

  private printResult(result: BenchmarkResult): void {
    console.log(`  Results:`);
    console.log(`    Avg: ${result.avgLatencyMs.toFixed(2)}ms`);
    console.log(`    P50: ${result.p50LatencyMs.toFixed(2)}ms`);
    console.log(`    P95: ${result.p95LatencyMs.toFixed(2)}ms`);
    console.log(`    P99: ${result.p99LatencyMs.toFixed(2)}ms`);
    console.log(`    Throughput: ${result.throughputOpsPerSec.toFixed(0)} ops/sec`);
    console.log(`    Memory: ${result.memoryUsageMB.toFixed(2)} MB`);
  }

  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  generateComparisonTable(): ComparisonTable {
    const scenarios = [...new Set(this.results.map(r => r.name))];
    const frameworks: Record<string, Record<string, BenchmarkResult>> = {};

    for (const result of this.results) {
      if (!frameworks[result.framework]) {
        frameworks[result.framework] = {};
      }
      frameworks[result.framework][result.name] = result;
    }

    return {
      scenarios,
      frameworks,
      generatedAt: new Date().toISOString(),
    };
  }

  printComparisonTable(): void {
    const table = this.generateComparisonTable();
    const frameworks = Object.keys(table.frameworks);

    console.log('\n' + '='.repeat(80));
    console.log('BENCHMARK COMPARISON TABLE');
    console.log('='.repeat(80));

    // Header
    const header = ['Scenario', ...frameworks].map(f => f.padEnd(20));
    console.log(header.join(' | '));
    console.log('-'.repeat(80));

    // Rows
    for (const scenario of table.scenarios) {
      const row = [scenario.padEnd(20)];
      for (const framework of frameworks) {
        const result = table.frameworks[framework]?.[scenario];
        if (result) {
          row.push(`${result.avgLatencyMs.toFixed(1)}ms`.padEnd(20));
        } else {
          row.push('N/A'.padEnd(20));
        }
      }
      console.log(row.join(' | '));
    }

    console.log('='.repeat(80));
  }
}

// ============================================================
// Helper Functions
// ============================================================

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// ============================================================
// Standard Scenarios
// ============================================================

export const standardScenarios = {
  /**
   * Event stream creation and basic operations
   */
  eventStreamCreation: (): BenchmarkScenario => ({
    name: 'Event Stream Creation',
    description: 'Measure overhead of imperative while(true) event loop',
    iterations: 1000,
    warmupIterations: 100,
    setup: async () => {},
    run: async () => {
      // Imperative loop benchmark — 10 iterations with event emission
      let count = 0;
      while (count < 10) {
        count++;
      }
    },
    teardown: async () => {},
  }),

  /**
   * Zod schema validation
   */
  zodValidation: (): BenchmarkScenario => ({
    name: 'Zod Schema Validation',
    description: 'Measure Zod schema parsing performance',
    iterations: 10000,
    warmupIterations: 1000,
    setup: async () => {},
    run: async () => {
      const { z } = await import('zod');

      const schema = z.object({
        type: z.string(),
        payload: z.object({
          id: z.string(),
          data: z.record(z.unknown()),
        }),
        timestamp: z.number(),
      });

      schema.parse({
        type: 'test.event',
        payload: { id: '123', data: { key: 'value' } },
        timestamp: Date.now(),
      });
    },
    teardown: async () => {},
  }),

  /**
   * Security guard checks
   */
  securityCheck: (): BenchmarkScenario => ({
    name: 'Security Guard Check',
    description: 'Measure security validation overhead',
    iterations: 10000,
    warmupIterations: 1000,
    setup: async () => {},
    run: async () => {
      const { SecurityGuard } = await import('../src/security/guard.js');
      const guard = new SecurityGuard();

      guard.checkCommand('ls -la');
      guard.checkPath('/tmp/test.txt', 'read');
      guard.checkNetwork('api.openai.com');
    },
    teardown: async () => {},
  }),

  /**
   * Rate limiter check
   */
  rateLimitCheck: (): BenchmarkScenario => ({
    name: 'Rate Limiter Check',
    description: 'Measure rate limiting overhead',
    iterations: 100000,
    warmupIterations: 10000,
    setup: async () => {},
    run: async () => {
      const { InMemoryRateLimiter } = await import('../src/security/rate-limit/rate-limiter.js');
      const limiter = new InMemoryRateLimiter();
      const config = { maxRequests: 100, windowMs: 60000 };

      limiter.check('test-key', config);
      limiter.consume('test-key', config);
    },
    teardown: async () => {},
  }),

  /**
   * Quota controller check
   */
  quotaCheck: (): BenchmarkScenario => ({
    name: 'Quota Controller Check',
    description: 'Measure quota validation overhead',
    iterations: 10000,
    warmupIterations: 1000,
    setup: async () => {},
    run: async () => {
      const { MemoryQuotaController } = await import('../src/quota/memory-quota-controller.js');
      const controller = new MemoryQuotaController({
        maxPromptTokens: 100000,
        maxCompletionTokens: 50000,
      });

      await controller.check('session-1', { promptTokens: 100, completionTokens: 0 });
      controller.consume('session-1', { promptTokens: 100, completionTokens: 50 });
    },
    teardown: async () => {},
  }),
};

// ============================================================
// Export
// ============================================================

export default BenchmarkRunner;
