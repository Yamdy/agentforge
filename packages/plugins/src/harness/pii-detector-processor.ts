import { z } from 'zod';
import type { Processor, ProcessorContext, PipelineContext } from '@primo-ai/sdk';
import { SpanAttributeKeys, SpanType } from '@primo-ai/sdk';
import { textContentFromBlocks } from '@primo-ai/core';

export interface PiiMatch {
  type: string;
  text: string;
  index: number;
}

export interface PiiDetectorConfig {
  enabled: boolean;
  strategy: 'redact' | 'warn' | 'block';
  piiTypes: string[];
  customPatterns?: Record<string, RegExp>;
  redactionText?: string;
}

/** Default regex patterns for each PII type. */
const DEFAULT_PATTERNS: Record<string, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  ip: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

/** Detect PII in text using configured patterns. Returns all matches found. */
function detectPii(
  text: string,
  piiTypes: string[],
  customPatterns?: Record<string, RegExp>,
): PiiMatch[] {
  const matches: PiiMatch[] = [];

  for (const type of piiTypes) {
    // Check custom patterns first, then defaults
    const pattern = customPatterns?.[type] ?? DEFAULT_PATTERNS[type];
    if (!pattern) continue;

    // Reset lastIndex for global regex reuse
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        type,
        text: match[0],
        index: match.index,
      });
    }
  }

  return matches;
}

/** Replace all matches in text with the redaction string, working in reverse order. */
function redactMatches(text: string, matches: PiiMatch[], redaction: string): string {
  if (matches.length === 0) return text;

  // Sort in reverse index order to preserve positions
  const sorted = [...matches].sort((a, b) => b.index - a.index);
  let result = text;
  for (const m of sorted) {
    result = result.slice(0, m.index) + redaction + result.slice(m.index + m.text.length);
  }
  return result;
}

/**
 * Create a PII detector processor that scans input/output for personally identifiable information.
 *
 * Registers on `processInput` stage. Also checks `iteration.response` for output.
 *
 * Strategies:
 * - `redact` — replace PII with [REDACTED] (or custom text)
 * - `warn`   — log a warning and continue (original text preserved)
 * - `block`  — abort with an error message
 */
const PiiDetectorConfigSchema = z.object({
  enabled: z.boolean(),
  strategy: z.enum(['redact', 'warn', 'block']),
  piiTypes: z.array(z.string().min(1)).min(1),
  customPatterns: z.record(z.string(), z.unknown()).optional(),
  redactionText: z.string().optional(),
});

export function createPiiDetectorProcessor(config: PiiDetectorConfig): Processor {
  PiiDetectorConfigSchema.parse(config);
  return {
    stage: 'processInput',
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      if (!config.enabled) return;

      const redaction = config.redactionText ?? '[REDACTED]';

      const inputMatches = detectPii(ctx.session.input, config.piiTypes, config.customPatterns);
      const outputText = ctx.iteration.content
        ? textContentFromBlocks(ctx.iteration.content)
        : ctx.iteration.response;
      const outputMatches = outputText
        ? detectPii(outputText, config.piiTypes, config.customPatterns)
        : [];

      const allMatches = [...inputMatches, ...outputMatches];
      const hasPii = allMatches.length > 0;

      const childSpan = pCtx.span?.startChild(SpanType.GATE_DECISION);
      childSpan?.setAttribute('pii.matchCount', allMatches.length);
      childSpan?.setAttribute('pii.types', [...new Set(allMatches.map((m) => m.type))]);

      if (!hasPii) {
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'allowed');
        childSpan?.end();
        ctx.session.custom = { ...ctx.session.custom, piiDetector: { lastDecision: 'allowed', matches: [] } };
        return;
      }

      if (inputMatches.length > 0) {
        if (config.strategy === 'block') {
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'blocked');
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'PII detected in input');
          childSpan?.end();
          pCtx.control.abort(`PII detected in input: ${[...new Set(inputMatches.map((m) => m.type))].join(', ')}`);
          return;
        }

        if (config.strategy === 'warn') {
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'warned');
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'PII detected in input');
          childSpan?.end();
          ctx.session.custom = { ...ctx.session.custom, piiDetector: { lastDecision: 'warned', matches: inputMatches } };
          return;
        }

        const redactedInput = redactMatches(ctx.session.input, inputMatches, redaction);
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'redacted');
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'PII redacted in input');
        childSpan?.end();
        ctx.session.input = redactedInput;
        ctx.session.custom = { ...ctx.session.custom, piiDetector: { lastDecision: 'redacted', matches: inputMatches } };
        return;
      }

      if (outputMatches.length > 0) {
        if (config.strategy === 'block') {
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'blocked');
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'PII detected in output');
          childSpan?.end();
          pCtx.control.abort(`PII detected in output: ${[...new Set(outputMatches.map((m) => m.type))].join(', ')}`);
          return;
        }

        if (config.strategy === 'warn') {
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'warned');
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'PII detected in output');
          childSpan?.end();
          ctx.session.custom = { ...ctx.session.custom, piiDetector: { lastDecision: 'warned', matches: outputMatches } };
          return;
        }

        const redactedResponse = redactMatches(outputText!, outputMatches, redaction);
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'redacted');
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'PII redacted in output');
        childSpan?.end();

        const updatedContent = ctx.iteration.content?.map((block) =>
          block.type === 'text' ? { ...block, text: redactedResponse } : block
        );

        ctx.iteration.response = redactedResponse;
        if (updatedContent) ctx.iteration.content = updatedContent;
        ctx.session.custom = { ...ctx.session.custom, piiDetector: { lastDecision: 'redacted', matches: outputMatches } };
        return;
      }

      childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'allowed');
      childSpan?.end();
    },
  };
}
