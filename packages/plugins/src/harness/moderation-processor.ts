import { z } from 'zod';
import type { Processor, PipelineContext, ProcessorResult } from '@agentforge/sdk';
import { SpanAttributeKeys, SpanType } from '@agentforge/sdk';

export interface ModerationMatch {
  category: string;
  text: string;
  index: number;
}

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
  matches: ModerationMatch[];
}

export interface ModerationConfig {
  enabled: boolean;
  strategy: 'block' | 'warn' | 'redact';
  categories: string[];
  checker?: (text: string, categories: string[]) => ModerationResult;
  blockMessage?: string;
}

/** Default keyword/pattern patterns for each moderation category. */
const DEFAULT_PATTERNS: Record<string, RegExp[]> = {
  violence: [
    /\b(kill|murder|assassinate|massacre|slaughter|torture|mutilate|bomb|shoot|stab|attack|destroy|weapon|explode)\b/gi,
  ],
  hate: [
    /\b(hate\s+(all|those|every|people|you)\b|\b(racist|bigot|nazi|slur)\b|\bhate\s+(group|speech)\b)/gi,
  ],
  'self-harm': [
    /\b(hurt\s+myself|kill\s+myself|self-harm|self\s+harm|suicide|suicidal|end\s+my\s+life)\b/gi,
  ],
  sexual: [
    /\b(pornograph|sexually\s+explicit|sexual\s+content|nsfw|nude|naked)\b/gi,
  ],
  harassment: [
    /\b(threaten|bully|harass|stalk|intimidate|coerce|persecute)\b/gi,
  ],
};

/** Default checker using keyword/pattern matching. */
function defaultChecker(text: string, categories: string[]): ModerationResult {
  const matches: ModerationMatch[] = [];

  for (const category of categories) {
    const patterns = DEFAULT_PATTERNS[category];
    if (!patterns) continue;

    for (const pattern of patterns) {
      // Reset lastIndex for global regex reuse
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        matches.push({
          category,
          text: match[0],
          index: match.index,
        });
      }
    }
  }

  return {
    flagged: matches.length > 0,
    categories: [...new Set(matches.map((m) => m.category))],
    matches,
  };
}

const REDACTION = '[REDACTED]';

/**
 * Create a moderation processor that checks input/output for harmful content.
 *
 * Registers on `processInput` stage. When used for output checking,
 * the processor examines `iteration.response`.
 *
 * Strategies:
 * - `block` — abort with an error message
 * - `warn`  — log a warning and continue (original text preserved)
 * - `redact` — replace matched content with [REDACTED]
 */
const ModerationConfigSchema = z.object({
  enabled: z.boolean(),
  strategy: z.enum(['block', 'warn', 'redact']),
  categories: z.array(z.string().min(1)).min(1),
  checker: z.unknown().optional(),
  blockMessage: z.string().optional(),
});

export function createModerationProcessor(config: ModerationConfig): Processor {
  ModerationConfigSchema.parse(config);
  return {
    stage: 'processInput',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      if (!config.enabled) return ctx;

      const checker = config.checker ?? defaultChecker;
      const blockMessage = config.blockMessage ?? 'Content blocked by moderation policy';

      // Check user input
      const inputResult = checker(ctx.request.input, config.categories);

      // Check LLM output (response) if present
      const outputText = ctx.iteration.response;
      let outputResult: ModerationResult | undefined;
      if (outputText) {
        outputResult = checker(outputText, config.categories);
      }

      const combinedFlagged = inputResult.flagged || (outputResult?.flagged ?? false);
      const allMatches = [...inputResult.matches, ...(outputResult?.matches ?? [])];

      const childSpan = ctx.iteration.span?.startChild(SpanType.GATE_DECISION);
      childSpan?.setAttribute('moderation.flagged', combinedFlagged);
      childSpan?.setAttribute('moderation.matchCount', allMatches.length);

      if (!combinedFlagged) {
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'allowed');
        childSpan?.end();
        return {
          ...ctx,
          session: {
            ...ctx.session,
            custom: {
              ...ctx.session.custom,
              moderation: { lastDecision: 'allowed', matches: [] },
            },
          },
        };
      }

      // Determine which text to apply strategy to
      // Priority: if input is flagged, handle input; if output is flagged, handle output
      if (inputResult.flagged) {
        if (config.strategy === 'block') {
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'blocked');
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, `Moderation: ${blockMessage}`);
          childSpan?.setAttribute('moderation.categories', inputResult.categories);
          childSpan?.end();
          return {
            type: 'abort',
            reason: `Moderation: ${blockMessage}`,
          };
        }

        if (config.strategy === 'warn') {
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'warned');
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'Moderation: harmful content detected in input');
          childSpan?.setAttribute('moderation.categories', inputResult.categories);
          childSpan?.end();
          return {
            ...ctx,
            session: {
              ...ctx.session,
              custom: {
                ...ctx.session.custom,
                moderation: { lastDecision: 'warned', matches: inputResult.matches },
              },
            },
          };
        }

        // redact strategy
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'redacted');
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'Moderation: harmful content redacted');
        childSpan?.setAttribute('moderation.categories', inputResult.categories);
        childSpan?.end();

        let redactedInput = ctx.request.input;
        // Replace matches in reverse order to preserve indices
        const sortedMatches = [...inputResult.matches].sort((a, b) => b.index - a.index);
        for (const m of sortedMatches) {
          redactedInput =
            redactedInput.slice(0, m.index) + REDACTION + redactedInput.slice(m.index + m.text.length);
        }

        return {
          ...ctx,
          request: { ...ctx.request, input: redactedInput },
          session: {
            ...ctx.session,
            custom: {
              ...ctx.session.custom,
              moderation: { lastDecision: 'redacted', matches: inputResult.matches },
            },
          },
        };
      }

      // Output flagged
      if (outputResult!.flagged) {
        if (config.strategy === 'block') {
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'blocked');
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, `Moderation: ${blockMessage}`);
          childSpan?.setAttribute('moderation.categories', outputResult!.categories);
          childSpan?.end();
          return {
            type: 'abort',
            reason: `Moderation: ${blockMessage}`,
          };
        }

        if (config.strategy === 'warn') {
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'warned');
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'Moderation: harmful content detected in output');
          childSpan?.setAttribute('moderation.categories', outputResult!.categories);
          childSpan?.end();
          return {
            ...ctx,
            session: {
              ...ctx.session,
              custom: {
                ...ctx.session.custom,
                moderation: { lastDecision: 'warned', matches: outputResult!.matches },
              },
            },
          };
        }

        // redact strategy for output
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'redacted');
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'Moderation: harmful content redacted in output');
        childSpan?.setAttribute('moderation.categories', outputResult!.categories);
        childSpan?.end();

        let redactedResponse = outputText!;
        const sortedMatches = [...outputResult!.matches].sort((a, b) => b.index - a.index);
        for (const m of sortedMatches) {
          redactedResponse =
            redactedResponse.slice(0, m.index) + REDACTION + redactedResponse.slice(m.index + m.text.length);
        }

        return {
          ...ctx,
          iteration: { ...ctx.iteration, response: redactedResponse },
          session: {
            ...ctx.session,
            custom: {
              ...ctx.session.custom,
              moderation: { lastDecision: 'redacted', matches: outputResult!.matches },
            },
          },
        };
      }

      // Should not reach here, but safe fallback
      childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'allowed');
      childSpan?.end();
      return ctx;
    },
  };
}
