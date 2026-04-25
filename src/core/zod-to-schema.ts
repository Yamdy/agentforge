/**
 * AgentForge Zod-to-Schema Conversion
 *
 * Converts Zod schemas to JSON Schema and LLM FunctionDefinition format.
 * Supports all common Zod types: primitives, objects, arrays, enums,
 * unions, optional, default, describe, literal, record, and nested schemas.
 *
 * @module
 */

import { z, ZodFirstPartyTypeKind } from 'zod';
import type { ZodTypeAny } from 'zod';
import type { FunctionDefinition, ToolDefinition } from './interfaces.js';

// ============================================================
// Zod Internal Type Definitions
// ============================================================

/**
 * Minimal type definition for Zod's internal _def structure.
 * Zod's _def is typed as `any` internally, so we define the shape we actually use.
 */
interface ZodDef {
  typeName: ZodFirstPartyTypeKind;
  checks?: Array<{ kind: string; value?: unknown }>;
  value?: unknown;
  values?: unknown;
  type?: ZodTypeAny;
  innerType?: ZodTypeAny;
  left?: ZodTypeAny;
  right?: ZodTypeAny;
  shape?: () => Record<string, ZodTypeAny>;
  valueType?: ZodTypeAny;
  items?: unknown;
  options?: unknown;
  defaultValue?: unknown;
  in?: ZodTypeAny;
  getter?: () => unknown;
  schema?: ZodTypeAny;
  description?: string;
}

// ============================================================
// Zod Schema → JSON Schema
// ============================================================

/**
 * Internal result from zodToJsonSchema that tracks whether a field is optional.
 * Used internally by object handling to determine the `required` array.
 */
interface JsonSchemaWithMeta {
  schema: Record<string, unknown>;
  isOptional: boolean;
}

/**
 * Convert a Zod schema to a JSON Schema object.
 *
 * Handles: string, number, boolean, array, object, enum, union,
 * optional, default, describe, literal, record, and nested schemas.
 *
 * @param zodSchema - Any Zod type
 * @returns JSON Schema representation
 */
export function zodToJsonSchema(zodSchema: z.ZodTypeAny): Record<string, unknown> {
  return convertSchema(zodSchema).schema;
}

/**
 * Internal recursive converter that also tracks optionality.
 */
function convertSchema(schema: z.ZodTypeAny): JsonSchemaWithMeta {
  const def = schema._def as ZodDef;

  switch (def.typeName) {
    // ----- Primitives -----
    case ZodFirstPartyTypeKind.ZodString: {
      const result: Record<string, unknown> = { type: 'string' };
      const checks = def.checks;
      if (checks) {
        for (const check of checks) {
          if (check.kind === 'min') result.minLength = check.value;
          if (check.kind === 'max') result.maxLength = check.value;
          if (check.kind === 'email') result.format = 'email';
          if (check.kind === 'url') result.format = 'uri';
          if (check.kind === 'uuid') result.format = 'uuid';
        }
      }
      return { schema: result, isOptional: false };
    }

    case ZodFirstPartyTypeKind.ZodNumber: {
      const result: Record<string, unknown> = { type: 'number' };
      const checks = def.checks;
      if (checks) {
        for (const check of checks) {
          if (check.kind === 'int') result.type = 'integer';
          if (check.kind === 'min') result.minimum = check.value;
          if (check.kind === 'max') result.maximum = check.value;
        }
      }
      return { schema: result, isOptional: false };
    }

    case ZodFirstPartyTypeKind.ZodBoolean:
      return { schema: { type: 'boolean' }, isOptional: false };

    case ZodFirstPartyTypeKind.ZodNull:
      return { schema: { type: 'null' }, isOptional: false };

    case ZodFirstPartyTypeKind.ZodUndefined:
      return { schema: {}, isOptional: true };

    case ZodFirstPartyTypeKind.ZodVoid:
      return { schema: {}, isOptional: true };

    case ZodFirstPartyTypeKind.ZodAny:
      return { schema: {}, isOptional: false };

    case ZodFirstPartyTypeKind.ZodUnknown:
      return { schema: {}, isOptional: false };

    // ----- Literal -----
    case ZodFirstPartyTypeKind.ZodLiteral: {
      const value = def.value as string | number | boolean;
      return { schema: { const: value }, isOptional: false };
    }

    // ----- Enum -----
    case ZodFirstPartyTypeKind.ZodEnum: {
      const values = def.values as string[];
      return { schema: { type: 'string', enum: values }, isOptional: false };
    }

    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      // Native enums can be arrays or objects
      const rawValues = def.values;
      let values: string[];
      if (Array.isArray(rawValues)) {
        values = rawValues.filter((v): v is string => typeof v === 'string');
      } else if (rawValues && typeof rawValues === 'object') {
        values = Object.values(rawValues as Record<string, unknown>).filter(
          (v): v is string => typeof v === 'string'
        );
      } else {
        values = [];
      }
      return { schema: { type: 'string', enum: values }, isOptional: false };
    }

    // ----- Array -----
    case ZodFirstPartyTypeKind.ZodArray: {
      const itemType = convertSchema(def.type as ZodTypeAny);
      const result: Record<string, unknown> = {
        type: 'array',
        items: itemType.schema,
      };
      const checks = def.checks;
      if (checks) {
        for (const check of checks) {
          if (check.kind === 'min') result.minItems = check.value;
          if (check.kind === 'max') result.maxItems = check.value;
        }
      }
      return { schema: result, isOptional: false };
    }

    // ----- Object -----
    case ZodFirstPartyTypeKind.ZodObject: {
      const shapeFn = def.shape;
      if (!shapeFn) {
        return { schema: { type: 'object' }, isOptional: false };
      }
      const shape = shapeFn();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const converted = convertSchema(value);
        properties[key] = converted.schema;
        if (!converted.isOptional) {
          required.push(key);
        }
      }

      const result: Record<string, unknown> = {
        type: 'object',
        properties,
      };

      if (required.length > 0) {
        result.required = required;
      }

      return { schema: result, isOptional: false };
    }

    // ----- Record -----
    case ZodFirstPartyTypeKind.ZodRecord: {
      const valueType = convertSchema(def.valueType as ZodTypeAny);
      return {
        schema: {
          type: 'object',
          additionalProperties: valueType.schema,
        },
        isOptional: false,
      };
    }

    // ----- Tuple -----
    case ZodFirstPartyTypeKind.ZodTuple: {
      const rawItems = def.items;
      const items = Array.isArray(rawItems)
        ? rawItems.map((item: ZodTypeAny) => convertSchema(item).schema)
        : [];
      return { schema: { type: 'array', items }, isOptional: false };
    }

    // ----- Union / Discriminated Union -----
    case ZodFirstPartyTypeKind.ZodUnion: {
      const rawOptions = def.options;
      const options = Array.isArray(rawOptions)
        ? rawOptions.map((opt: ZodTypeAny) => convertSchema(opt).schema)
        : [];
      return { schema: { oneOf: options }, isOptional: false };
    }

    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const rawOptions = def.options;
      const options = Array.isArray(rawOptions)
        ? rawOptions.map((opt: ZodTypeAny) => convertSchema(opt).schema)
        : [];
      return { schema: { oneOf: options }, isOptional: false };
    }

    // ----- Intersection -----
    case ZodFirstPartyTypeKind.ZodIntersection: {
      const left = convertSchema(def.left as ZodTypeAny).schema;
      const right = convertSchema(def.right as ZodTypeAny).schema;
      return { schema: { allOf: [left, right] }, isOptional: false };
    }

    // ----- Optional -----
    case ZodFirstPartyTypeKind.ZodOptional: {
      const inner = convertSchema(def.innerType as ZodTypeAny);
      return { schema: inner.schema, isOptional: true };
    }

    // ----- Nullable -----
    case ZodFirstPartyTypeKind.ZodNullable: {
      const inner = convertSchema(def.innerType as ZodTypeAny);
      return {
        schema: { oneOf: [inner.schema, { type: 'null' }] },
        isOptional: false,
      };
    }

    // ----- Default -----
    case ZodFirstPartyTypeKind.ZodDefault: {
      const inner = convertSchema(def.innerType as ZodTypeAny);
      const result: Record<string, unknown> = { ...inner.schema };
      const defaultValue = def.defaultValue;
      if (typeof defaultValue === 'function') {
        result.default = (defaultValue as () => unknown)();
      } else {
        result.default = defaultValue;
      }
      return { schema: result, isOptional: inner.isOptional };
    }

    // ----- Describe (Branded / Catch) -----
    case ZodFirstPartyTypeKind.ZodBranded: {
      return convertSchema(def.type as ZodTypeAny);
    }

    case ZodFirstPartyTypeKind.ZodCatch: {
      const inner = convertSchema(def.innerType as ZodTypeAny);
      return { schema: inner.schema, isOptional: inner.isOptional };
    }

    // ----- Pipeline / Lazy / Effects -----
    case ZodFirstPartyTypeKind.ZodPipeline: {
      return convertSchema(def.in as ZodTypeAny);
    }

    case ZodFirstPartyTypeKind.ZodLazy: {
      // Evaluate lazy schema
      const lazySchema = def.getter as () => ZodTypeAny;
      return convertSchema(lazySchema());
    }

    case ZodFirstPartyTypeKind.ZodEffects: {
      // Effects are validation-only; use the inner schema
      return convertSchema(def.schema as ZodTypeAny);
    }

    // ----- Readonly / Non-optional wrappers -----
    case ZodFirstPartyTypeKind.ZodReadonly: {
      return convertSchema(def.innerType as ZodTypeAny);
    }

    default:
      // Fallback: return empty schema for unknown types
      return { schema: {}, isOptional: false };
  }
}

// ============================================================
// Zod Schema → LLM FunctionDefinition
// ============================================================

/**
 * Convert a Zod schema to an LLM function definition.
 *
 * @param name - Function name
 * @param description - Function description
 * @param schema - Zod schema for parameters
 * @returns FunctionDefinition for LLM tool calling
 */
export function zodToFunctionDef<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: T,
): FunctionDefinition {
  const jsonSchema = zodToJsonSchema(schema);

  // If schema is not an object, wrap it in an object with 'value' property
  if (jsonSchema.type !== 'object' || !jsonSchema.properties) {
    return {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          value: jsonSchema,
        },
        required: ['value'],
      },
    };
  }

  return {
    name,
    description,
    parameters: jsonSchema as {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    },
  };
}

/**
 * Convert a ToolDefinition with Zod schema to FunctionDefinition.
 *
 * @param tool - Tool definition with Zod parameters
 * @returns FunctionDefinition for LLM tool calling
 */
export function toolToFunctionDef(tool: ToolDefinition): FunctionDefinition {
  return zodToFunctionDef(tool.name, tool.description, tool.parameters as z.ZodTypeAny);
}

/**
 * Convert an array of ToolDefinitions to FunctionDefinitions.
 *
 * @param tools - Array of tool definitions
 * @returns Array of function definitions
 */
export function toolsToFunctionDefs(tools: ToolDefinition[]): FunctionDefinition[] {
  return tools.map(toolToFunctionDef);
}
