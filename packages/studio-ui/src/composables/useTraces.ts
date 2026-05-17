import { useQuery } from '@tanstack/vue-query';
import { computed, unref } from 'vue';
import type { MaybeRef } from 'vue';
import { fetchTraces, fetchTrace } from '../api/traces';
import type { TraceSummary } from '../types';

export function useTraces(filter?: MaybeRef<Record<string, string>>) {
  const resolvedFilter = computed(() => unref(filter) ?? {});
  const query = useQuery({
    queryKey: ['traces', resolvedFilter] as const,
    queryFn: ({ queryKey }) => fetchTraces(queryKey[1]),
  });

  return {
    traces: computed<TraceSummary[]>(() => query.data.value?.traces ?? []),
    total: computed(() => query.data.value?.total ?? 0),
    isLoading: computed(() => query.isLoading.value),
    isError: computed(() => query.isError.value),
    error: computed(() => query.error.value),
  };
}

export function useTrace(id: string) {
  const query = useQuery({
    queryKey: ['trace', id] as const,
    queryFn: ({ queryKey }) => fetchTrace(queryKey[1]),
    enabled: computed(() => !!id),
  });

  return {
    trace: computed(() => query.data.value?.trace ?? null),
    isLoading: computed(() => query.isLoading.value),
    isError: computed(() => query.isError.value),
  };
}
