import { z } from 'zod';
import type { JSONValue, ToolDef } from './types.js';

/**
 * Check whether a value is JSON-serializable.
 */
function isJSONValue(value: unknown): value is JSONValue {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJSONValue);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJSONValue);
  }
  return false;
}

/**
 * Create a ToolDef from a typed configuration object.
 *
 * The generic type parameter `T` is captured from the Zod schema so that
 * `params` inside `execute` is fully type-safe.
 *
 * At runtime the return value of `execute` is validated to ensure it is
 * JSON-serializable.
 */
export function tool<TSchema extends z.ZodTypeAny>(config: {
  name: string;
  description: string;
  schema: TSchema;
  execute: (params: z.infer<TSchema>) => Promise<JSONValue>;
}): ToolDef<TSchema> {
  return {
    name: config.name,
    description: config.description,
    schema: config.schema,
    execute: async (params: z.infer<TSchema>): Promise<JSONValue> => {
      const result = await config.execute(params);
      if (!isJSONValue(result)) {
        throw new Error(
          `Tool "${config.name}" returned non-JSON-serializable value`
        );
      }
      return result;
    },
  };
}

/**
 * Create a tool registry backed by a Map.
 */
export function createToolRegistry() {
  const tools = new Map<string, ToolDef>();

  return {
    register(toolDef: ToolDef): void {
      tools.set(toolDef.name, toolDef);
    },
    get(name: string): ToolDef | undefined {
      return tools.get(name);
    },
    list(): ToolDef[] {
      return Array.from(tools.values());
    },
    has(name: string): boolean {
      return tools.has(name);
    },
  };
}
