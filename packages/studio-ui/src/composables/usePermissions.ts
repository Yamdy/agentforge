import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import { fetchPendingPermissions, respondPermission, type PendingPermission } from '../api/permissions';

export function usePermissions() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['permissions'],
    queryFn: fetchPendingPermissions,
    refetchInterval: 3000,
  });

  const permissions = computed<PendingPermission[]>(() => query.data.value?.permissions ?? []);
  const pendingCount = computed(() => permissions.value.length);

  const approveMutation = useMutation({
    mutationFn: (permissionId: string) => respondPermission(permissionId, true),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['permissions'] }),
  });

  const denyMutation = useMutation({
    mutationFn: (permissionId: string) => respondPermission(permissionId, false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['permissions'] }),
  });

  return {
    permissions,
    pendingCount,
    isLoading: computed(() => query.isLoading.value),
    isError: computed(() => query.isError.value),
    approve: (id: string) => approveMutation.mutate(id),
    deny: (id: string) => denyMutation.mutate(id),
  };
}
