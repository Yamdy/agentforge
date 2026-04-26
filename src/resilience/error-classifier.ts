/**
 * Error Classifier - MPU-M4 异常熔断
 *
 * Classifies errors by severity:
 * - Minor: network timeout, parameter format error
 * - Moderate: tool execution failure, LLM output invalid
 * - Severe: permission violation, sandbox escape, goal deviation
 *
 * @module
 */

import type { SerializedError } from '../core/events.js';
import type { ErrorSeverity, ErrorClassifier } from '../contracts/mpu-interfaces.js';

/**
 * Classification patterns for each severity level.
 *
 * Order matters: severe patterns are checked first (highest priority).
 */
interface SeverityPattern {
  severity: ErrorSeverity;
  patterns: RegExp[];
}

const SEVERITY_PATTERNS: SeverityPattern[] = [
  {
    severity: 'severe',
    patterns: [
      /permission\s*(denied|violation)/i,
      /access\s*denied/i,
      /sandbox\s*(escape|violation)/i,
      /container\s*escape/i,
      /unauthorized\s*syscall/i,
      /goal\s*deviation/i,
      /injection\s*detected/i,
      /prompt\s*injection/i,
    ],
  },
  {
    severity: 'moderate',
    patterns: [
      /tool\s*(execution|error)/i,
      /failed\s*to\s*execute\s*tool/i,
      /llm\s*output\s*invalid/i,
      /parse\s*error/i,
      /failed\s*to\s*parse\s*llm/i,
      /rate\s*limit/i,
      /429\s*too\s*many/i,
      /api\s*(error|request\s*failed)/i,
      /status\s*5\d{2}/i,
    ],
  },
  {
    severity: 'minor',
    patterns: [
      /timeout/i,
      /timed?\s*out/i,
      /etimedout/i,
      /econnreset/i,
      /econnrefused/i,
      /validation\s*(error|failed)/i,
      /invalid\s*(parameter|format|argument)/i,
      /zoderror/i,
      /schema\s*(error|validation)/i,
      /expected\s*.*received/i,
      /missing\s*required/i,
    ],
  },
];

/**
 * Default error classifier implementation.
 *
 * Classification priority: severe > moderate > minor > default (moderate)
 */
export class DefaultErrorClassifier implements ErrorClassifier {
  classify(error: SerializedError): ErrorSeverity {
    const text = `${error.name} ${error.message}`;

    // Check in priority order: severe first, then moderate, then minor
    for (const { severity, patterns } of SEVERITY_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return severity;
        }
      }
    }

    // Default: unknown errors are moderate
    return 'moderate';
  }
}
