import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { fetchAgents } from '../api/agents';
import type { AgentInfo } from '../types';

export function useAgents() {
  const query = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
  });

  return {
    agents: computed<AgentInfo[]>(() => query.data.value?.agents ?? []),
    isLoading: computed(() => query.isLoading.value),
    isError: computed(() => query.isError.value),
  };
}
