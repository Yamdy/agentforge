/**
 * Task Completion Scorer
 *
 * Evaluates how completely the agent fulfilled the user's request by
 * decomposing the request into sub-goals and checking which were completed
 * in the output. Uses an LLM for sub-goal decomposition and verification,
 * then computes a deterministic completion ratio.
 *
 * @module evaluation/scorers/task-completion
 */

import { LLMScorer } from '../llm-scorer.js';
import type { LLMScorerConfig, ScoringContext } from '../types.js';

/**
 * Sub-goal as extracted by the LLM analyze step.
 */
interface Subgoal {
  description: string;
  completed: boolean;
}

/**
 * Create a pre-configured Task Completion scorer.
 *
 * @param config - LLM judge adapter and optional weight (id/name/description are preset)
 * @returns A ready-to-use LLMScorer that evaluates task fulfillment
 *
 * @example
 * ```ts
 * const completionScorer = createTaskCompletionScorer({ judge: myLLM });
 * const result = await completionScorer.evaluate(ctx);
 * ```
 */
export function createTaskCompletionScorer(
  config: Omit<LLMScorerConfig, 'id' | 'name' | 'description'>
): LLMScorer {
  return LLMScorer.create({
    id: 'task-completion',
    name: 'Task Completion',
    description: 'Evaluates how completely the agent fulfilled the user request',
    ...config,
  })
    .preprocess((ctx: ScoringContext) => ({
      request: ctx.input,
      output: ctx.output,
    }))
    .analyze(async (_ctx, pre, llm) => {
      const { request, output } = pre as {
        request: string;
        output: string;
      };

      const resp = await llm.chat(
        [
          {
            role: 'system',
            content:
              'You are an expert task evaluator. Decompose the user request into sub-goals and determine whether the output completes each one. Output ONLY valid JSON.',
          },
          {
            role: 'user',
            content: [
              `User Request: ${request}`,
              `Agent Output: ${output}`,
              '',
              'Decompose the user request into individual sub-goals or requirements.',
              'For each sub-goal, check whether the output satisfies it.',
              'Output JSON in this exact format:',
              '{ "subgoals": [{ "description": "sub-goal text", "completed": true }] }',
            ].join('\n'),
          },
        ],
        { temperature: 0 }
      );

      try {
        return JSON.parse(resp.content) as unknown as { subgoals: Subgoal[] };
      } catch {
        return { subgoals: [] as Subgoal[] };
      }
    })
    .score((_ctx, results) => {
      const analysis = results.analysis as {
        subgoals?: Subgoal[];
      };
      const subgoals = analysis?.subgoals ?? [];

      if (subgoals.length === 0) return 0;

      const completedCount = subgoals.filter(s => s.completed).length;
      return completedCount / subgoals.length;
    })
    .reason((_ctx, results, score) => {
      const analysis = results.analysis as {
        subgoals?: Subgoal[];
      };
      const subgoals = analysis?.subgoals ?? [];
      const completedCount = subgoals.filter(s => s.completed).length;
      const pct = Math.round(score * 100);
      return `${completedCount}/${subgoals.length} sub-goals completed (${pct}%)`;
    })
    .build();
}
