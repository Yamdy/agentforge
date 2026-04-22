import type { Effect } from "effect";

export class PluginError {
  readonly _tag = "PluginError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export interface PluginHooks {
  "agent:created"?: (agent: any) => Effect.Effect<void, PluginError>;
  "agent:destroyed"?: (agent: any) => Effect.Effect<void, PluginError>;
  "tool:registered"?: (tool: any) => Effect.Effect<void, PluginError>;
  "session:created"?: (session: any) => Effect.Effect<void, PluginError>;
  "message:added"?: (message: any) => Effect.Effect<void, PluginError>;
}

export interface PluginContext {
  agentForgeVersion: string;
  config: Record<string, unknown>;
  registerHook: <K extends keyof PluginHooks>(
    event: K,
    handler: NonNullable<PluginHooks[K]>
  ) => void;
  getService: <T>(serviceId: string) => T;
}

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;

  install(context: PluginContext): Effect.Effect<void, PluginError>;
  uninstall(): Effect.Effect<void, PluginError>;
  initialize(): Effect.Effect<void, PluginError>;
  destroy(): Effect.Effect<void, PluginError>;
  hooks(): PluginHooks;
}
