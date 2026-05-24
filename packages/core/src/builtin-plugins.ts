/** No-op. Builtin plugins must be registered by the application layer (e.g. server). */
export function registerBuiltinPluginsOnce(): void {
  // Builtin plugin registration is decoupled from core to avoid circular
  // dependencies. The application layer (e.g. @primo-ai/server) should call
  // globalPluginRegistry.register('memory', ...) etc. at startup.
}
