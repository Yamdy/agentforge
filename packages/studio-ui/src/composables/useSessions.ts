import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { fetchSessions, fetchSession, fetchSessionEvents } from '../api/sessions';
import type { SessionSummary, SessionDetail } from '../types';

export function useSessions(filter?: Record<string, string>) {
  const query = useQuery({
    queryKey: ['sessions', filter] as const,
    queryFn: ({ queryKey }) => fetchSessions(queryKey[1]),
  });

  return {
    sessions: computed<SessionSummary[]>(() => query.data.value?.sessions ?? []),
    total: computed(() => query.data.value?.total ?? 0),
    isLoading: computed(() => query.isLoading.value),
    isError: computed(() => query.isError.value),
  };
}

export function useSession(id: string) {
  const query = useQuery({
    queryKey: ['session', id] as const,
    queryFn: ({ queryKey }) => fetchSession(queryKey[1]),
    enabled: computed(() => !!id),
  });

  return {
    session: computed<SessionDetail | null>(() => query.data.value?.session ?? null),
    isLoading: computed(() => query.isLoading.value),
    isError: computed(() => query.isError.value),
  };
}

export function useSessionEvents(id: string) {
  const query = useQuery({
    queryKey: ['session-events', id] as const,
    queryFn: ({ queryKey }) => fetchSessionEvents(queryKey[1]),
    enabled: computed(() => !!id),
  });

  return {
    events: computed<SessionDetail['events']>(() => query.data.value?.events ?? []),
    isLoading: computed(() => query.isLoading.value),
  };
}
