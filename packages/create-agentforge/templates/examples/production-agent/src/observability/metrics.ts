/**
 * Console metrics collector for production agent (M8).
 *
 * Collects and reports agent execution metrics.
 */

export interface MetricEntry {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export class ConsoleMetrics {
  private metrics: MetricEntry[] = [];

  increment(name: string, value: number = 1, tags?: Record<string, string>): void {
    this.metrics.push({
      name,
      value,
      timestamp: Date.now(),
      tags,
    });
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    this.metrics.push({
      name,
      value,
      timestamp: Date.now(),
      tags,
    });
  }

  timing(name: string, durationMs: number, tags?: Record<string, string>): void {
    this.metrics.push({
      name,
      value: durationMs,
      timestamp: Date.now(),
      tags,
    });
  }

  getMetrics(): MetricEntry[] {
    return [...this.metrics];
  }

  report(): string {
    const summary = new Map<string, { count: number; total: number }>();
    for (const metric of this.metrics) {
      const existing = summary.get(metric.name) ?? { count: 0, total: 0 };
      existing.count += 1;
      existing.total += metric.value;
      summary.set(metric.name, existing);
    }
    const lines: string[] = [];
    for (const [name, { count, total }] of summary) {
      lines.push(`  ${name}: count=${count}, total=${total}, avg=${(total / count).toFixed(2)}`);
    }
    return lines.join('\n');
  }

  clear(): void {
    this.metrics = [];
  }
}

export const metrics = new ConsoleMetrics();