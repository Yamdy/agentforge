/**
 * Answer Accuracy Scorer
 *
 * Evaluates factual correctness by decomposing the agent's answer into
 * individual claims and verifying each against the original question.
 * Uses an LLM to extract claims, then computes a deterministic score
 * from the ratio of correct to total claims.
 *
 * @module evaluation/scorers/answer-accuracy
 */

import { LLMScorer } from '../llm-scorer.js';
import type { LLMScorerConfig, ScoringContext } from '../types.js';

/**
 * Create a pre-configured Answer Accuracy scorer.
 *
 * @param config - LLM judge adapter and optional weight (id/name/description are preset)
 * @returns A ready-to-use LLMScorer that evaluates factual correctness
 *
 * @example
 * ```ts
 * const accuracyScorer = createAnswerAccuracyScorer({ judge: myLLM });
 * const result = await accuracyScorer.evaluate(ctx);
 * ```
 */
export function createAnswerAccuracyScorer(
  config: Omit<LLMScorerConfig, 'id' | 'name' | 'description'>
): LLMScorer {
  return LLMScorer.create({
    id: 'answer-accuracy',
    name: 'Answer Accuracy',
    description: 'Evaluates factual correctness by claim verification',
    ...config,
  })
    .preprocess((ctx: ScoringContext) => ({
      question: ctx.input,
      answer: ctx.output,
    }))
    .analyze(async (_ctx, pre, llm) => {
      const { question, answer } = pre as {
        question: string;
        answer: string;
      };

      const resp = await llm.chat(
        [
          {
            role: 'system',
            content:
              'You are an expert fact-checker. Extract individual factual claims from the answer and verify each against the question. Output ONLY valid JSON.',
          },
          {
            role: 'user',
            content: [
              `Question: ${question}`,
              `Answer: ${answer}`,
              '',
              'Extract each factual claim from the answer. For each claim, determine if it is factually correct relative to the question.',
              'Output JSON in this exact format:',
              '{ "claims": [{ "text": "claim text", "correct": true }] }',
            ].join('\n'),
          },
        ],
        { temperature: 0 }
      );

      try {
        const parsed: unknown = JSON.parse(resp.content);
        return parsed;
      } catch {
        return { claims: [] as Array<{ text: string; correct: boolean }> };
      }
    })
    .score((_ctx, results) => {
      const analysis = results.analysis as {
        claims?: Array<{ text: string; correct: boolean }>;
      };
      const claims = analysis?.claims ?? [];

      if (claims.length === 0) return 0;

      const correctCount = claims.filter(c => c.correct).length;
      return correctCount / claims.length;
    })
    .reason((_ctx, results, score) => {
      const analysis = results.analysis as {
        claims?: Array<{ text: string; correct: boolean }>;
      };
      const claims = analysis?.claims ?? [];
      const correctCount = claims.filter(c => c.correct).length;
      const pct = Math.round(score * 100);
      return `${correctCount}/${claims.length} claims correct (${pct}%)`;
    })
    .build();
}
