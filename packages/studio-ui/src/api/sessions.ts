import { api } from './client';
import type { SessionSummary, SessionDetail } from '../types';

export async function fetchSessions(params?: Record<string, string>): Promise<{ sessions: SessionSummary[]; total: number }> {
  return api('/sessions', { query: params });
}

export async function fetchSession(id: string): Promise<{ session: SessionDetail }> {
  return api(`/sessions/${id}`);
}

export async function fetchSessionEvents(id: string): Promise<{ events: SessionDetail['events'] }> {
  return api(`/sessions/${id}/events`);
}
