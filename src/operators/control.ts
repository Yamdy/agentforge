/**
 * AgentForge Control Flow Operators
 *
 * Specialized RxJS operators for controlling agent event stream flow.
 * These operators emit `agent.error` events instead of throwing,
 * ensuring the stream remains stable and errors can be handled gracefully.
 *
 * @module
 */

import { Observable, defer, from } from 'rxjs';
import type { MonoTypeOperatorFunction } from 'rxjs';
import { tap, mergeMap, catchError } from 'rxjs/operators';
import { type AgentEvent, type AgentEventType, serializeError } from '../core/index.js';

// ============================================================
// Error Event Factory
// ============================================================

/**
 * Create an agent.error event from an error
 *
 * @internal
 */
function createErrorEvent(error: unknown, sessionId: string, step?: number): AgentEvent {
  return {
    type: 'agent.error',
    timestamp: Date.now(),
    sessionId,
    error: serializeError(error),
    step,
  };
}

/**
 * Create a done event to terminate the stream
 *
 * @internal
 */
function createDoneEvent(
  sessionId: string,
  reason: 'stop' | 'error' | 'cancelled' | 'length' = 'error'
): AgentEvent {
  return {
    type: 'done',
    timestamp: Date.now(),
    sessionId,
    reason,
  };
}

// ============================================================
// retryOnEventType
// ============================================================

/**
 * Retry operator specialized for agent event streams.
 *
 * Monitors the stream for error events matching the specified event type
 * (e.g., 'llm.error', 'tool.error', 'agent.error') and triggers a retry
 * by resubscribing to the source after the stream completes with 'done'.
 * Non-matching errors do not trigger retry.
 *
 * Design note: In AgentForge's errors-as-events architecture, this operator
 * watches for error events in the stream. When a matching error event is
 * detected and the stream completes normally (with 'done'), it delays and
 * then resubscribes to the source observable.
 *
 * @param eventType - The error event type to watch for (e.g., 'llm.error')
 * @param count - Maximum number of retry attempts
 * @param delay - Optional delay between retries in milliseconds (default: 1000)
 *
 * @example
 * // Retry on llm.error events, up to 3 times, with 500ms delay
 * source.pipe(retryOnEventType('llm.error', 3, 500))
 *
 * @example
 * // Retry on tool.error with exponential backoff
 * source.pipe(retryOnEventType('tool.error', 3))
 */
export function retryOnEventType(
  eventType: AgentEventType,
  count: number,
  delay: number = 1000
): MonoTypeOperatorFunction<AgentEvent> {
  return source =>
    defer(() => {
      let retryCount = 0;

      return new Observable<AgentEvent>(subscriber => {
        let subscription: ReturnType<typeof source.subscribe> | null = null;
        let hasMatchingError = false;
        let currentSessionId = '';
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const subscribe = (): void => {
          hasMatchingError = false;
          subscription = source.subscribe({
            next(event: AgentEvent) {
              // Track session ID
              if ('sessionId' in event) {
                currentSessionId = event.sessionId;
              }
              // Check if this is a matching error event
              if (event.type === eventType) {
                hasMatchingError = true;
              }
              subscriber.next(event);
            },
            complete() {
              subscription = null;
              // Check if we should retry
              if (hasMatchingError && retryCount < count) {
                retryCount++;
                hasMatchingError = false;
                // Exponential backoff
                const backoffDelay = delay * Math.pow(2, retryCount - 1);
                timeoutId = setTimeout(() => {
                  timeoutId = null;
                  subscribe();
                }, backoffDelay);
              } else {
                // No retry needed, complete
                subscriber.complete();
              }
            },
            error(err: unknown) {
              subscription = null;
              // RxJS error - convert to agent.error event
              subscriber.next(createErrorEvent(err, currentSessionId));
              subscriber.next(createDoneEvent(currentSessionId, 'error'));
              // Then check retry
              if (retryCount < count) {
                retryCount++;
                timeoutId = setTimeout(
                  () => {
                    timeoutId = null;
                    subscribe();
                  },
                  delay * Math.pow(2, retryCount - 1)
                );
              } else {
                subscriber.complete();
              }
            },
          });
        };

        subscribe();

        return () => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (subscription !== null) {
            subscription.unsubscribe();
            subscription = null;
          }
        };
      });
    });
}

// ============================================================
// timeoutOnEventType
// ============================================================

/**
 * Timeout operator specialized for agent event streams.
 *
 * Monitors a specific event type and emits a timeout error if the expected
 * event is not received within the specified duration. The timeout timer
 * is reset each time any event is emitted, but specifically triggers
 * when waiting for the target event type.
 *
 * @param eventType - The event type to watch for
 * @param ms - Timeout duration in milliseconds
 *
 * @example
 * // Timeout if llm.response is not received within 30 seconds
 * source.pipe(timeoutOnEventType('llm.response', 30000))
 *
 * @example
 * // Timeout on tool execution
 * source.pipe(timeoutOnEventType('tool.result', 10000))
 */
export function timeoutOnEventType(
  eventType: AgentEventType,
  ms: number
): MonoTypeOperatorFunction<AgentEvent> {
  return source =>
    defer(() => {
      let currentSessionId = '';
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let timeoutFired = false;
      let hasReceivedTarget = false;

      return new Observable<AgentEvent>(subscriber => {
        const startTimeout = (): void => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          timeoutId = setTimeout(() => {
            if (!hasReceivedTarget && !timeoutFired) {
              timeoutFired = true;
              const timeoutError = new Error(
                `Timeout waiting for event type "${eventType}" after ${ms}ms`
              );
              timeoutError.name = 'TimeoutError';

              subscriber.next(createErrorEvent(timeoutError, currentSessionId));
              subscriber.next(createDoneEvent(currentSessionId, 'error'));
              subscriber.complete();
            }
          }, ms);
        };

        // Start timeout immediately when stream starts
        startTimeout();

        const subscription = source.subscribe({
          next(event) {
            if (timeoutFired) {
              return; // Already timed out, ignore further events
            }

            // Track session ID
            if ('sessionId' in event) {
              currentSessionId = event.sessionId;
            }

            // Check if we received the target event
            if (event.type === eventType) {
              hasReceivedTarget = true;
              // Clear timeout once we've received the target
              if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
            }

            subscriber.next(event);

            // Reset timeout on each event if we haven't received target yet
            if (!hasReceivedTarget) {
              startTimeout();
            }
          },
          error(err) {
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
            }
            subscriber.next(createErrorEvent(err, currentSessionId));
            subscriber.next(createDoneEvent(currentSessionId, 'error'));
            subscriber.complete();
          },
          complete() {
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
            }
            subscriber.complete();
          },
        });

        return () => {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          subscription.unsubscribe();
        };
      });
    });
}

// ============================================================
// requirePermission
// ============================================================

/**
 * Permission check operator for agent event streams.
 *
 * Intercepts `tool.call` events and checks if the tool execution is allowed.
 * If permission is denied, emits a `permission.prompt` event for user interaction,
 * then waits for a `permission.decision` event.
 *
 * @param check - Permission check function that returns true if allowed
 *
 * @example
 * // Simple permission check
 * source.pipe(requirePermission(async (event) => {
 *   return event.toolName !== 'dangerous_tool';
 * }))
 *
 * @example
 * // Permission check with tool name filtering
 * source.pipe(requirePermission(async (event) => {
 *   if (event.type === 'tool.call' && event.toolName === 'delete_file') {
 *     return false; // Deny delete_file
 *   }
 *   return true;
 * }))
 */
export function requirePermission(
  check: (event: AgentEvent) => boolean | Promise<boolean>
): MonoTypeOperatorFunction<AgentEvent> {
  return source =>
    defer(() => {
      let currentSessionId = '';

      return source.pipe(
        // Track session ID for error events
        tap(event => {
          if ('sessionId' in event) {
            currentSessionId = event.sessionId;
          }
        }),
        mergeMap(async event => {
          // Only check permission for tool.call events
          if (event.type !== 'tool.call') {
            return [event];
          }

          try {
            const allowed = await check(event);

            if (!allowed) {
              const permissionError = new Error(
                `Permission denied for tool: ${(event as { toolName: string }).toolName}`
              );
              permissionError.name = 'PermissionDeniedError';

              return [
                createErrorEvent(permissionError, currentSessionId),
                createDoneEvent(currentSessionId, 'error'),
              ] as AgentEvent[];
            }

            return [event];
          } catch (err) {
            return [
              createErrorEvent(err, currentSessionId),
              createDoneEvent(currentSessionId, 'error'),
            ] as AgentEvent[];
          }
        }),
        mergeMap(events => from(events)),
        catchError(error => {
          return from([
            createErrorEvent(error, currentSessionId),
            createDoneEvent(currentSessionId, 'error'),
          ]);
        })
      );
    });
}

// ============================================================
// maxStepsLimit
// ============================================================

/**
 * Steps limit operator for agent event streams.
 *
 * Monitors `agent.step` events and emits an error when the step count
 * exceeds the maximum allowed. This is useful for preventing runaway
 * agent loops.
 *
 * @param max - Maximum number of steps allowed
 *
 * @example
 * // Limit to 10 steps
 * source.pipe(maxStepsLimit(10))
 *
 * @example
 * // Limit to 5 steps for development/testing
 * source.pipe(maxStepsLimit(5))
 */
export function maxStepsLimit(max: number): MonoTypeOperatorFunction<AgentEvent> {
  return source =>
    defer(() => {
      let currentSessionId = '';
      let currentStep = 0;

      return new Observable<AgentEvent>(subscriber => {
        return source.subscribe({
          next(event) {
            // Track session ID
            if ('sessionId' in event) {
              currentSessionId = event.sessionId;
            }

            // Check for step limit
            if (event.type === 'agent.step') {
              currentStep = (event as { step: number }).step;

              if (currentStep > max) {
                const limitError = new Error(`Maximum steps limit exceeded: ${max}`);
                limitError.name = 'MaxStepsExceededError';

                subscriber.next(createErrorEvent(limitError, currentSessionId, currentStep));
                subscriber.next(createDoneEvent(currentSessionId, 'length'));
                subscriber.complete();
                return;
              }
            }

            subscriber.next(event);
          },
          error(err) {
            subscriber.next(createErrorEvent(err, currentSessionId, currentStep));
            subscriber.next(createDoneEvent(currentSessionId, 'error'));
            subscriber.complete();
          },
          complete() {
            subscriber.complete();
          },
        });
      });
    });
}

// ============================================================
// pauseOnSignal
// ============================================================

/**
 * Pause operator for agent event streams.
 *
 * Buffers events when the pause signal emits `true`, and releases them
 * when the signal emits `false`. This is useful for implementing
 * pause/resume functionality.
 *
 * @param signal$ - An Observable<boolean> that controls pause state
 *                  true = paused, false = resumed
 *
 * @example
 * // Pause on external signal
 * const pauseSignal = new Subject<boolean>();
 * source.pipe(pauseOnSignal(pauseSignal))
 *
 * // Later: pauseSignal.next(true) to pause
 * // Then: pauseSignal.next(false) to resume
 *
 * @example
 * // Pause on specific condition
 * const pause$ = stateChange$.pipe(
 *   map(state => state.status === 'paused')
 * );
 * source.pipe(pauseOnSignal(pause$))
 */
export function pauseOnSignal(
  signal$: Observable<boolean>,
  options?: { maxBufferSize?: number }
): MonoTypeOperatorFunction<AgentEvent> {
  const maxBufferSize = options?.maxBufferSize ?? 1000;
  return source =>
    defer(() => {
      let currentSessionId = '';
      const buffer: AgentEvent[] = [];
      // Initialize paused state from signal if it's a BehaviorSubject-like observable
      let isPaused = 'value' in signal$ ? (signal$ as { value: boolean }).value : false;
      let sourceCompleted = false;
      let bufferOverflow = false;

      return new Observable<AgentEvent>(subscriber => {
        // Subscribe to pause signal to track state changes
        const signalSubscription = signal$.subscribe({
          next: paused => {
            isPaused = paused;
            // When resuming, release buffered events
            if (!paused) {
              while (buffer.length > 0) {
                subscriber.next(buffer.shift()!);
              }
              // If source completed while paused, complete now
              if (sourceCompleted) {
                subscriber.complete();
              }
            }
          },
          error: err => {
            // Release buffer and emit error
            while (buffer.length > 0) {
              subscriber.next(buffer.shift()!);
            }
            subscriber.next(createErrorEvent(err, currentSessionId));
            subscriber.next(createDoneEvent(currentSessionId, 'error'));
            subscriber.complete();
          },
        });

        const sourceSubscription = source.subscribe({
          next(event) {
            // Track session ID
            if ('sessionId' in event) {
              currentSessionId = event.sessionId;
            }

            if (isPaused) {
              // Buffer overflow protection
              if (buffer.length >= maxBufferSize) {
                // Only emit error once on first overflow
                if (!bufferOverflow) {
                  bufferOverflow = true;
                  subscriber.next(
                    createErrorEvent(
                      new Error(`Buffer overflow: paused too long (max ${maxBufferSize} events)`),
                      currentSessionId
                    )
                  );
                }
                // Drop the event - buffer is full
              } else {
                buffer.push(event);
              }
            } else {
              // Release buffered events first, then emit current
              while (buffer.length > 0) {
                subscriber.next(buffer.shift()!);
              }
              subscriber.next(event);
            }
          },
          error(err) {
            // Release buffer before error
            while (buffer.length > 0) {
              subscriber.next(buffer.shift()!);
            }
            subscriber.next(createErrorEvent(err, currentSessionId));
            subscriber.next(createDoneEvent(currentSessionId, 'error'));
            subscriber.complete();
          },
          complete() {
            if (isPaused) {
              // When paused, hold buffer until resumed
              // Mark that source completed
              sourceCompleted = true;
              return;
            }
            // Release all buffered events when not paused
            while (buffer.length > 0) {
              subscriber.next(buffer.shift()!);
            }
            subscriber.complete();
          },
        });

        return () => {
          signalSubscription.unsubscribe();
          sourceSubscription.unsubscribe();
        };
      });
    });
}

// ============================================================
// Re-exports for Convenience
// ============================================================

export { createErrorEvent as _createErrorEvent, createDoneEvent as _createDoneEvent };
