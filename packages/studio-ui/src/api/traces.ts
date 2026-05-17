import { api } from './client';
import type { TraceSummary, TraceDetail } from '../types';

export async function fetchTraces(params?: Record<string, string>): Promise<{ traces: TraceSummary[]; total: number }> {
  return api('/traces', { query: params });
}

export async function fetchTrace(id: string): Promise<{ trace: TraceDetail }> {
  return api(`/traces/${id}`);
}
