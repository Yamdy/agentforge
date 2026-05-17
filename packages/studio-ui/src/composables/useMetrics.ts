import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { fetchMetrics, fetchKpi } from '../api/metrics';
import type { MetricsSnapshot, KpiData } from '../types';

export function useMetrics() {
  const query = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
  });

  return {
    metrics: computed<MetricsSnapshot | null>(() => query.data.value?.metrics ?? null),
    isLoading: computed(() => query.isLoading.value),
  };
}

export function useKpi(period?: string) {
  const query = useQuery({
    queryKey: ['kpi', period] as const,
    queryFn: ({ queryKey }) => fetchKpi(queryKey[1]),
  });

  return {
    kpi: computed<KpiData | null>(() => query.data.value?.kpi ?? null),
    isLoading: computed(() => query.isLoading.value),
  };
}
