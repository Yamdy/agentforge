# Vercel AI SDK as LLM Provider Layer with Bundled SDK Map

We use the Vercel AI SDK (`ai` package) as the LLM provider abstraction layer rather than building our own multi-provider API. The AI SDK's `streamText` and `generateText` functions handle provider routing, streaming, tool calling, and token counting for 40+ providers.

On top of the AI SDK, we provide a **Bundled SDK Map** — a lightweight provider resolver (`model-resolver.ts`) that auto-resolves model strings to `LanguageModel` instances with zero configuration:

- **PROVIDER_MAP**: Static mapping of provider names to dynamic `import('@ai-sdk/*')` calls. Top 3 providers (OpenAI, Anthropic, Google) bundled as optional dependencies.
- **`resolveModel(modelString)`**: Async function that parses `'provider/model'` strings, resolves SDK instances (with caching), and returns a `LanguageModel`.
- **`registerProvider(name, factory)`**: Escape hatch for custom or test providers. Takes priority over built-in PROVIDER_MAP entries.
- **`parseModel(modelString)`**: Public utility for splitting model strings on first `/` (handles multi-segment model IDs like `openrouter/anthropic/claude-sonnet-4`).

**Resolution order**: `registerProvider` (custom/test) → `PROVIDER_MAP` (built-in dynamic import) → throw.

**Considered options:**
- Self-built provider abstraction (like Pi-mono's ApiRegistry): Complete control over the provider interface, no external dependency. But building and maintaining adapters for 40+ providers is months of work. Pi-mono's `pi-ai` package is ~3000 lines just for provider abstraction.
- Vercel AI SDK (chosen): Delegating provider management to the AI SDK means we get 40+ providers, streaming, tool calling, and token counting for free. Mastra and OpenCode both validate this approach in production. The SDK is well-maintained, actively developed, and has strong community adoption.
- Interface abstraction + AI SDK default: Define our own provider interface with the AI SDK as the default implementation. Maximum flexibility but adds a layer of indirection that may never be needed.

**Why the Bundled SDK Map on top**: Direct `@ai-sdk/*` imports require manual SDK instantiation and are hard to mock in tests. The resolver layer provides: (1) zero-config model string → LanguageModel, (2) testable via `registerProvider` override, (3) SDK instance caching to avoid repeated imports, (4) friendly errors when an `@ai-sdk/*` package is not installed.

**Consequences:** The framework is coupled to the Vercel AI SDK's API shape. If the SDK makes breaking changes, we must adapt. The SDK's model string format (`'provider/model'`) becomes our configuration format. We also inherit the SDK's limitations — if a provider isn't supported by the SDK, users must wait for an upstream fix or implement a custom provider through `registerProvider()` or the SDK's provider interface (which IS extensible).
