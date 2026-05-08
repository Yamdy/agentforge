# Vercel AI SDK as LLM Provider Layer (not self-built)

We use the Vercel AI SDK (`ai` package) as the LLM provider abstraction layer rather than building our own multi-provider API. The AI SDK's `streamText` and `generateText` functions handle provider routing, streaming, tool calling, and token counting for 40+ providers.

**Considered options:**
- Self-built provider abstraction (like Pi-mono's ApiRegistry): Complete control over the provider interface, no external dependency. But building and maintaining adapters for 40+ providers is months of work. Pi-mono's `pi-ai` package is ~3000 lines just for provider abstraction.
- Vercel AI SDK (chosen): Delegating provider management to the AI SDK means we get 40+ providers, streaming, tool calling, and token counting for free. Mastra and OpenCode both validate this approach in production. The SDK is well-maintained, actively developed, and has strong community adoption.
- Interface abstraction + AI SDK default: Define our own provider interface with the AI SDK as the default implementation. Maximum flexibility but adds a layer of indirection that may never be needed.

**Consequences:** The framework is coupled to the Vercel AI SDK's API shape. If the SDK makes breaking changes, we must adapt. The SDK's model string format (`'provider/model'`) becomes our configuration format. We also inherit the SDK's limitations — if a provider isn't supported by the SDK, users must wait for an upstream fix or implement a custom provider through the SDK's provider interface (which IS extensible).
