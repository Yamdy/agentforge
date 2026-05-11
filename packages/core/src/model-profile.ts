import type { PipelineContext, ModelProfile } from '@agentforge/sdk';

/**
 * Find the first ModelProfile whose modelPattern matches the given model string.
 * String patterns use simple `includes`; RegExp patterns use `test()`.
 */
export function matchProfile(
  model: string,
  profiles: ModelProfile[],
): ModelProfile | undefined {
  for (const profile of profiles) {
    if (profile.modelPattern instanceof RegExp) {
      if (profile.modelPattern.test(model)) return profile;
    } else {
      if (model.includes(profile.modelPattern)) return profile;
    }
  }
  return undefined;
}

/**
 * Apply a ModelProfile to a PipelineContext, returning a new context
 * (original is not mutated).
 *
 * - extraPromptFragments are converted from PromptFragment[] to strings
 *   by extracting `.content`, then appended to promptFragments.
 * - systemPromptSuffix is appended as a plain string after fragments.
 * - toolOverrides.exclude removes matching tools; description overrides update them.
 */
export function applyProfile(
  ctx: PipelineContext,
  profile: ModelProfile,
): PipelineContext {
  // Build new promptFragments: existing + extra (converted) + suffix
  const newFragments = profile.extraPromptFragments?.map((f) => f.content) ?? [];
  const promptFragments = [...ctx.agent.promptFragments, ...newFragments];

  if (profile.systemPromptSuffix) {
    promptFragments.push(profile.systemPromptSuffix);
  }

  // Apply tool overrides
  const overrides = profile.toolOverrides ?? {};
  const toolDeclarations = ctx.agent.toolDeclarations
    .filter((tool) => {
      const override = overrides[tool.name];
      return !override?.exclude;
    })
    .map((tool) => {
      const override = overrides[tool.name];
      if (override?.description) {
        return { ...tool, description: override.description };
      }
      return tool;
    });

  return {
    ...ctx,
    agent: {
      ...ctx.agent,
      promptFragments,
      toolDeclarations,
    },
  };
}
