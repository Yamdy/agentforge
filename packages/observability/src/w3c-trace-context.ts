import type { Span } from '@primo-ai/sdk';

// ── Traceparent format ─────────────────────────────────────────
// W3C traceparent: version(2hex)-traceId(32hex)-spanId(16hex)-flags(2hex)
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

// ── Random hex helpers (Node 18 fallback) ──────────────────────

let _crypto: Pick<Crypto, 'getRandomValues'> | undefined;

function getCrypto(): Pick<Crypto, 'getRandomValues'> {
  if (_crypto) return _crypto;
  try {
    // Prefer globalThis.crypto; fall back to node:crypto webcrypto on Node 18
    const g = globalThis as { crypto?: { getRandomValues?: (arr: Uint8Array) => void } };
    if (g.crypto?.getRandomValues) {
      _crypto = g.crypto as Pick<Crypto, 'getRandomValues'>;
      return _crypto;
    }
  } catch { /* fall through */ }
  // Node.js 18 fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { webcrypto } = require('node:crypto') as { webcrypto: Crypto };
    _crypto = webcrypto;
  } catch {
    throw new Error('crypto.getRandomValues is not available');
  }
  return _crypto;
}

export function generateHex32(): string {
  const bytes = new Uint8Array(16);
  getCrypto().getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateHex16(): string {
  const bytes = new Uint8Array(8);
  getCrypto().getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Extract / Inject ───────────────────────────────────────────

export interface TraceContext {
  traceId: string;
  spanId: string;
  tracestate?: string;
}

/**
 * Parse a W3C traceparent header into trace context.
 * Returns undefined if the header is missing or malformed.
 * Supports any version per W3C spec section 2.2.6.
 */
export function extractTraceContext(headers: Record<string, string>): TraceContext | undefined {
  const tp = headers.traceparent;
  if (!tp) return undefined;
  const m = TRACEPARENT_RE.exec(tp);
  if (!m) return undefined;
  const ctx: TraceContext = { traceId: m[2]!, spanId: m[3]! };
  if (headers.tracestate) {
    ctx.tracestate = headers.tracestate;
  }
  return ctx;
}

/**
 * Inject a W3C traceparent header from a span into outgoing headers.
 */
export function injectTraceContext(
  span: Span,
  headers: Record<string, string>,
  sampled = true,
): void {
  const ctx = span.spanContext();
  const flags = sampled ? '01' : '00';
  headers.traceparent = `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}
