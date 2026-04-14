/**
 * Create a suspend result that can be returned from a workflow step when you need to pause
 * execution and wait for external input or user approval before resuming.
 *
 * @example
 * ```typescript
 * const myStep = createStep('wait-for-approval', async (input, ctx) => {
 *   // Need user approval before proceeding
 *   return suspend({
 *     message: 'Please approve this change before proceeding',
 *   });
 * });
 * ```
 */
export function suspend(state: Record<string, unknown>, message?: string): WorkflowSuspendResult {
  return {
    suspended: true,
    state,
    message,
  };
}

/**
 * Check if a result is a suspend result
 */
export function isSuspended(result: unknown): result is WorkflowSuspendResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'suspended' in result &&
    (result as WorkflowSuspendResult).suspended === true
  );
}
