import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  createMiddlewarePipeline,
  Middleware,
  MiddlewareEvents,
  MiddlewarePipeline,
} from "../src";

describe("Middleware Pipeline", () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = createMiddlewarePipeline();
  });

  it("should execute middleware in order", async () => {
    const executionOrder: string[] = [];

    const mw1: Middleware = (next) => (ctx) => {
      executionOrder.push("1-before");
      return Effect.flatMap(next(ctx), (result) => {
        executionOrder.push("1-after");
        return Effect.succeed(result);
      });
    };

    const mw2: Middleware = (next) => (ctx) => {
      executionOrder.push("2-before");
      return Effect.flatMap(next(ctx), (result) => {
        executionOrder.push("2-after");
        return Effect.succeed(result);
      });
    };

    const testPipeline = pipeline.use(mw1).use(mw2);

    await Effect.runPromise(
      testPipeline.execute(MiddlewareEvents.AGENT_START, { input: "test" })
    );

    expect(executionOrder).toEqual([
      "1-before",
      "2-before",
      "2-after",
      "1-after",
    ]);
  });

  it("should pass context through middleware chain", async () => {
    const mw: Middleware = (next) => (ctx) => {
      return Effect.flatMap(next(ctx), (result) => {
        return Effect.succeed({
          ...result,
          metadata: { ...result.metadata, processed: true },
        });
      });
    };

    const testPipeline = pipeline.use(mw);

    const result = await Effect.runPromise(
      testPipeline.execute(MiddlewareEvents.AGENT_START, { input: "test" })
    );

    expect(result.metadata.processed).toBe(true);
  });

  it("should allow middleware to modify context", async () => {
    const mw: Middleware = (next) => (ctx) => {
      return Effect.flatMap(next(ctx), (result) => {
        return Effect.succeed({
          ...result,
          metadata: { ...result.metadata, modified: true },
        });
      });
    };

    const result = await Effect.runPromise(
      pipeline.use(mw).execute(MiddlewareEvents.AGENT_START, { input: "test" })
    );

    expect(result.metadata.modified).toBe(true);
  });
});