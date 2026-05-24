import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Middleware } from './index.js';
import type { StreamEvent } from '../types.js';
import { ValidationError } from '../errors/index.js';
import { logger } from '../logger/index.js';

export interface SecurityMiddlewareOptions {
  pii?: {
    enabled: boolean;
    action: 'redact' | 'block';
  };
  promptInjection?: {
    enabled: boolean;
    action: 'block' | 'warn';
    keywords?: string[];
  };
}

// PII detection patterns
const PII_PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phoneCN: /(?:\+?86)?1[3-9]\d{9}/g,
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  idCardCN: /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
};

// Default prompt injection detection keywords
const DEFAULT_INJECTION_KEYWORDS = [
  'ignore previous instructions',
  'forget all instructions',
  'disregard previous',
  'you are now',
  'from now on you are',
  'system prompt',
  'change your instructions',
  'new instructions',
];

const defaultOptions: Required<SecurityMiddlewareOptions> = {
  pii: {
    enabled: true,
    action: 'redact',
  },
  promptInjection: {
    enabled: true,
    action: 'warn',
    keywords: DEFAULT_INJECTION_KEYWORDS,
  },
};

export function createSecurityMiddleware(options: SecurityMiddlewareOptions = {}): Middleware {
  const config = {
    ...defaultOptions,
    ...options,
    pii: { ...defaultOptions.pii, ...options.pii },
    promptInjection: { ...defaultOptions.promptInjection, ...options.promptInjection },
  };

  return (source$: Observable<StreamEvent>) => {
    return source$.pipe(
      map((event) => {
        // Only process events that have content/text
        if (event.type !== 'text') {
          return event;
        }

        let content = event.content;
        if (!content) return event;

        // PII detection and processing
        if (config.pii.enabled) {
          let hasPii = false;
          for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
            // Reset lastIndex since regex is global
            pattern.lastIndex = 0;
            if (pattern.test(content)) {
              hasPii = true;
              if (config.pii.action === 'block') {
                throw new ValidationError(`PII (${type}) detected and blocked`);
              } else if (config.pii.action === 'redact') {
                // Reset lastIndex again for replacement
                pattern.lastIndex = 0;
                content = content.replace(pattern, '[REDACTED]');
              }
            }
          }
          if (hasPii) {
            logger.debug('[security] PII redacted from content');
          }
        }

        // Prompt injection detection
        if (config.promptInjection.enabled && config.promptInjection.keywords) {
          const contentLower = content.toLowerCase();
          const detectedKeywords = config.promptInjection.keywords.filter((keyword) =>
            contentLower.includes(keyword.toLowerCase())
          );

          if (detectedKeywords.length > 0) {
            const message = `Possible prompt injection detected: matched keywords: ${detectedKeywords.join(', ')}`;
            if (config.promptInjection.action === 'block') {
              throw new ValidationError(message);
            } else if (config.promptInjection.action === 'warn') {
              logger.warn(`[security] ${message}`);
            }
          }
        }

        return { ...event, content };
      })
    );
  };
}
