import { Effect } from "effect";
import type {
  Middleware,
  MiddlewareContext,
  MiddlewareNext,
  MiddlewareEventType,
} from "../types";

export interface Metrics {
  llmCalls: number;
  llmTokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  toolCalls: number;
  agentSteps: number;
  errors: number;
  durations: Map<MiddlewareEventType, number[]>;
}

export interface MetricsMiddlewareOptions {
  /**
   * 要跟踪的事件列表
   */
  trackedEvents?: MiddlewareEventType[];
  /**
   * 指标回调函数，每次指标更新时调用
   */
  onMetricsUpdate?: (metrics: Metrics) => void;
}

export function createMetricsMiddleware(
  options: MetricsMiddlewareOptions = {}
): Middleware & { getMetrics: () => Metrics; resetMetrics: () => void } {
  const {
    trackedEvents,
    onMetricsUpdate,
  } = options;

  let metrics: Metrics = {
    llmCalls: 0,
    llmTokens: {
      prompt: 0,
      completion: 0,
      total: 0,
    },
    toolCalls: 0,
    agentSteps: 0,
    errors: 0,
    durations: new Map(),
  };

  const startTimeMap = new Map<string, number>();

  const updateMetrics = (context: MiddlewareContext, phase: "before" | "after", duration?: number) => {
    const event = context.event;

    if (trackedEvents && !trackedEvents.includes(event)) return;

    // Before phase: record start time
    if (phase === "before") {
      startTimeMap.set(event, Date.now());
      return;
    }

    // After phase: update metrics
    if (phase === "after" && duration !== undefined) {
      // Track durations
      if (!metrics.durations.has(event)) {
        metrics.durations.set(event, []);
      }
      metrics.durations.get(event)!.push(duration);

      // Track specific events
      switch (event) {
        case "llm.request.after":
          metrics.llmCalls++;
          if (context.data.usage) {
            const usage = context.data.usage as any;
            metrics.llmTokens.prompt += usage.promptTokens || 0;
            metrics.llmTokens.completion += usage.completionTokens || 0;
            metrics.llmTokens.total += usage.totalTokens || 0;
          }
          break;
        case "tool.call.end":
          metrics.toolCalls++;
          break;
        case "agent.step.complete":
          metrics.agentSteps++;
          break;
        case "agent.error":
        case "tool.call.error":
          metrics.errors++;
          break;
      }

      // Notify callback
      if (onMetricsUpdate) {
        onMetricsUpdate(metrics);
      }
    }
  };

  const getMetrics = (): Metrics => ({ ...metrics });

  const resetMetrics = () => {
    metrics = {
      llmCalls: 0,
      llmTokens: {
        prompt: 0,
        completion: 0,
        total: 0,
      },
      toolCalls: 0,
      agentSteps: 0,
      errors: 0,
      durations: new Map(),
    };
    startTimeMap.clear();
  };

  const middleware: Middleware = (next: MiddlewareNext) => {
    return (context: MiddlewareContext) => {
      const event = context.event;
      
      updateMetrics(context, "before");
      const startTime = Date.now();

      return Effect.flatMap(next(context), (result) => {
        const duration = Date.now() - startTime;
        updateMetrics(result, "after", duration);
        return Effect.succeed(result);
      });
    };
  };

  return Object.assign(middleware, { getMetrics, resetMetrics });
}
