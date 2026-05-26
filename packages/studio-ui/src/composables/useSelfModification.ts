import { useQuery } from '@tanstack/vue-query';
import { computed, type Ref } from 'vue';
import { fetchConstitution, fetchBudget, fetchWatchdog } from '../api/self-modification';

export function useConstitution(agentId: Ref<string | null>) {
  const query = useQuery({
    queryKey: ['constitution', agentId] as const,
    queryFn: ({ queryKey }) => fetchConstitution(queryKey[1]!),
    enabled: computed(() => !!agentId.value),
  });

  return {
    constitution: computed(() => query.data.value ?? null),
    isLoading: computed(() => query.isLoading.value),
  };
}

export function useBudget(agentId: Ref<string | null>) {
  const query = useQuery({
    queryKey: ['budget', agentId] as const,
    queryFn: ({ queryKey }) => fetchBudget(queryKey[1]!),
    enabled: computed(() => !!agentId.value),
    refetchInterval: 5000,
  });

  return {
    budget: computed(() => query.data.value ?? null),
    isLoading: computed(() => query.isLoading.value),
  };
}

export function useWatchdog(agentId: Ref<string | null>) {
  const query = useQuery({
    queryKey: ['watchdog', agentId] as const,
    queryFn: ({ queryKey }) => fetchWatchdog(queryKey[1]!),
    enabled: computed(() => !!agentId.value),
    refetchInterval: 10000,
  });

  return {
    watchdog: computed(() => query.data.value ?? null),
    isLoading: computed(() => query.isLoading.value),
  };
}
