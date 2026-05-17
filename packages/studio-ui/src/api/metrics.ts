import { api } from './client';
import type { MetricsSnapshot, KpiData } from '../types';

export async function fetchMetrics(): Promise<{ metrics: MetricsSnapshot }> {
  return api('/metrics');
}

export async function fetchKpi(period?: string): Promise<{ kpi: KpiData }> {
  return api('/kpi', { query: { period } });
}
