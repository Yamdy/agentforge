import { randomUUID } from 'node:crypto';

const SENSITIVE_PATTERNS = [
  { pattern: /\bsk-[a-zA-Z0-9]{10,}\b/g, replacement: '[REDACTED_KEY]' },
  { pattern: /\bkey-[a-zA-Z0-9-]{8,}\b/g, replacement: '[REDACTED_KEY]' },
  { pattern: /\bBearer\s+[a-zA-Z0-9\-._~+/]+=*/g, replacement: 'Bearer [REDACTED_TOKEN]' },
  { pattern: /https?:\/\/[^\s]+/g, replacement: '[REDACTED_URL]' },
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, replacement: '[REDACTED_ADDRESS]' },
  { pattern: /(?:\/[/a-zA-Z0-9_.-]+\.(?:ts|js|json|env))/g, replacement: '[REDACTED_PATH]' },
  { pattern: /\s+at\s+[a-zA-Z0-9_.]+\s+.*/g, replacement: '' },
  { pattern: /\bTCPConnectWrap\b/g, replacement: '' },
  { pattern: /\bECONNREFUSED\b/g, replacement: 'connection refused' },
  { pattern: /\bECONNRESET\b/g, replacement: 'connection reset' },
  { pattern: /\bETIMEDOUT\b/g, replacement: 'timed out' },
];

const KNOWN_ERROR_MESSAGES = [
  { pattern: /rate.?limit/i, message: 'Request rate limit exceeded. Please try again later.' },
  { pattern: /quota/i, message: 'API quota exceeded.' },
  { pattern: /invalid.*api.*key|unauthorized|authentication/i, message: 'Authentication error. Please check your configuration.' },
  { pattern: /connection.*(refused|reset|timed.out)|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i, message: 'Unable to connect to the AI provider. Please try again.' },
  { pattern: /not found|404/i, message: 'The requested resource was not found.' },
  { pattern: /abort|cancel/i, message: 'The operation was cancelled.' },
  { pattern: /context.*length|token.*limit|too.*large/i, message: 'The request exceeded the maximum allowed size.' },
  { pattern: /overloaded|503|server.*error/i, message: 'The AI provider is temporarily unavailable. Please try again.' },
];

export function sanitizeError(err: unknown) {
  const correlationId = randomUUID();
  if (!(err instanceof Error)) {
    return { message: 'An unexpected error occurred.', correlationId };
  }
  const originalMessage = err.message;
  for (const { pattern, message } of KNOWN_ERROR_MESSAGES) {
    if (pattern.test(originalMessage)) {
      return { message, correlationId };
    }
  }
  let sanitized = originalMessage;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();
  if (!sanitized || sanitized.length < 5) {
    sanitized = 'An internal error occurred.';
  }
  return { message: sanitized, correlationId };
}
