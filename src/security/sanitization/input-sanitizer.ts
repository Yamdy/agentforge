/**
 * AgentForge Input Sanitizer
 */

// ============================================================
// Types
// ============================================================

export interface InjectionCheckResult {
  isMalicious: boolean;
  confidence: number;
  patterns: string[];
  sanitizedInput: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  sanitized?: Record<string, unknown>;
}

export interface InputSanitizerConfig {
  maxLength: number;
  sensitivity: 'low' | 'medium' | 'high';
  customPatterns?: Array<{ name: string; pattern: RegExp; severity: 'low' | 'medium' | 'high' }>;
  sanitizeMode: boolean;
}

export const DEFAULT_INPUT_SANITIZER_CONFIG: InputSanitizerConfig = {
  maxLength: 100000,
  sensitivity: 'medium',
  sanitizeMode: true,
};

// ============================================================
// Patterns
// ============================================================

const L1_PATTERNS = [
  {
    name: 'system_prompt_extraction',
    pattern:
      /(?:ignore\s+(?:all\s+)?(?:previous|above|earlier)\s+instructions?|disregard\s+(?:all\s+)?(?:previous|above)\s+(?:instructions?|prompts?))/i,
    severity: 'high',
  },
  {
    name: 'instruction_override',
    pattern: /(?:you\s+are\s+now|from\s+now\s+on|new\s+(?:instructions?|rules?|directives?))/i,
    severity: 'high',
  },
  {
    name: 'role_switch',
    pattern:
      /(?:act\s+as\s+(?:a\s+)?(?:DAN|jailbroken|unrestricted|uncensored)|you\s+(?:are|must)\s+not\s+(?:bound|limited|restricted))/i,
    severity: 'high',
  },
  {
    name: 'invisible_chars',
    pattern: /[\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/,
    severity: 'medium',
  },
];

const L2_PATTERNS = [
  {
    name: 'embedded_instruction',
    pattern: /(?:system:|assistant:|user:|<\|system\|>|<\|assistant\|>|<\|user\|>)/i,
    severity: 'high',
  },
];

const SENSITIVITY_THRESHOLDS: Record<string, number> = { low: 0.7, medium: 0.4, high: 0.2 };

// ============================================================
// Implementation
// ============================================================

export class DefaultInputSanitizer implements InputSanitizer {
  private readonly config: InputSanitizerConfig;
  private readonly allPatterns = [...L1_PATTERNS, ...L2_PATTERNS];

  constructor(config: Partial<InputSanitizerConfig> = {}) {
    this.config = { ...DEFAULT_INPUT_SANITIZER_CONFIG, ...config };
  }

  detectInjection(input: string): InjectionCheckResult {
    const patterns: string[] = [];
    let maxSeverityScore = 0;

    if (input.length > this.config.maxLength) {
      patterns.push('input_too_long');
      maxSeverityScore = Math.max(maxSeverityScore, 0.5);
    }

    let sanitized = input;
    for (const { name, pattern, severity } of this.allPatterns) {
      if (pattern.test(input)) {
        patterns.push(name);
        const score = severity === 'high' ? 1.0 : severity === 'medium' ? 0.6 : 0.3;
        maxSeverityScore = Math.max(maxSeverityScore, score);
      }
    }

    const confidence =
      patterns.length > 0 ? Math.min(1, maxSeverityScore + patterns.length * 0.1) : 0;

    const threshold = SENSITIVITY_THRESHOLDS[this.config.sensitivity] ?? 0.4;
    const isMalicious = confidence >= threshold;

    if (this.config.sanitizeMode) {
      sanitized = this.sanitizeInput(input);
    }

    return { isMalicious, confidence, patterns, sanitizedInput: sanitized };
  }

  sanitize(input: string): string {
    return this.sanitizeInput(input);
  }

  validateToolArgs(toolName: string, args: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        const check = this.detectInjection(value);
        if (check.isMalicious) {
          errors.push(
            `Argument '${key}' of tool '${toolName}' contains suspicious patterns: ${check.patterns.join(', ')}`
          );
          sanitized[key] = check.sanitizedInput;
        } else {
          sanitized[key] = value;
        }
      } else {
        sanitized[key] = value;
      }
    }

    const result: ValidationResult = { valid: errors.length === 0, sanitized };
    if (errors.length > 0) {
      result.errors = errors;
    }
    return result;
  }

  private sanitizeInput(input: string): string {
    let result = input;
    for (const { pattern } of this.allPatterns) {
      result = result.replace(pattern, '[REDACTED]');
    }
    result = result.replace(/[\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, '');
    return result;
  }
}

export interface InputSanitizer {
  detectInjection(input: string): InjectionCheckResult;
  sanitize(input: string): string;
  validateToolArgs(toolName: string, args: Record<string, unknown>): ValidationResult;
}
