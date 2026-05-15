import { SpanAttributeKeys, type Span } from '@agentforge/sdk';

/** Set gate decision attributes on a span. */
export function setGateDecision(
  span: Span | undefined,
  decision: 'allowed' | 'blocked' | 'warned',
  reason?: string,
): void {
  if (!span) return;
  span.setAttribute(SpanAttributeKeys.HARNESS_DECISION, decision);
  if (reason) span.setAttribute(SpanAttributeKeys.HARNESS_REASON, reason);
}

/** Set cost-related attributes on a span. */
export function setCostAttributes(
  span: Span | undefined,
  estimated: number,
  cumulative: number,
  budget: number,
): void {
  if (!span) return;
  span.setAttribute(SpanAttributeKeys.COST_ESTIMATED, estimated);
  span.setAttribute(SpanAttributeKeys.COST_CUMULATIVE, cumulative);
  span.setAttribute(SpanAttributeKeys.COST_BUDGET, budget);
}

/** Set budget-related attributes on a span. */
export function setBudgetAttributes(
  span: Span | undefined,
  max: number,
  used: number,
  reserved: number,
): void {
  if (!span) return;
  span.setAttribute(SpanAttributeKeys.BUDGET_CONTEXT_MAX, max);
  span.setAttribute(SpanAttributeKeys.BUDGET_CONTEXT_USED, used);
  span.setAttribute(SpanAttributeKeys.BUDGET_RESERVED_OUTPUT, reserved);
}
