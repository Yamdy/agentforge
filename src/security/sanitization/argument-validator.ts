/**
 * AgentForge Argument Validator
 */

export type ArgsViolation =
  | { type: 'path_traversal'; arg: string; value: string; pattern: string }
  | { type: 'command_injection'; arg: string; value: string; pattern: string }
  | { type: 'sql_injection'; arg: string; value: string; pattern: string }
  | { type: 'custom'; arg: string; value: string; reason: string };

export interface ArgsSanitizeResult {
  valid: boolean;
  sanitized: Record<string, unknown>;
  violations?: ArgsViolation[];
}

export interface ArgsValidatorConfig {
  checkPathTraversal: boolean;
  checkCommandInjection: boolean;
  checkSqlInjection: boolean;
  customPatterns?: Array<{
    name: string;
    pattern: RegExp;
    type: 'path_traversal' | 'command_injection' | 'sql_injection' | 'custom';
  }>;
}

export const DEFAULT_ARGS_VALIDATOR_CONFIG: ArgsValidatorConfig = {
  checkPathTraversal: true,
  checkCommandInjection: true,
  checkSqlInjection: true,
};

const PATH_TRAVERSAL_PATTERNS = [
  { pattern: /\.\.[\\/]/, name: 'parent_directory' },
  { pattern: /\.\.%2[fF]/, name: 'encoded_parent' },
  { pattern: /%2[eE]%2[eE]/, name: 'double_encoded_dots' },
  { pattern: /[\\/](etc|proc|sys|dev|tmp)[\\/]/i, name: 'system_directory' },
];

const COMMAND_INJECTION_PATTERNS = [
  { pattern: /[;&|`$]/, name: 'shell_metacharacters' },
  { pattern: /\$\(/, name: 'command_substitution' },
  { pattern: /`[^`]*`/, name: 'backtick_execution' },
  { pattern: /\b(rm|chmod|chown|sudo|su|eval|exec)\b/i, name: 'dangerous_commands' },
  { pattern: />\s*\//, name: 'redirect_to_path' },
];

const SQL_INJECTION_PATTERNS = [
  { pattern: /('|(--|;--)|\/\*|\*\/)/i, name: 'sql_comment_or_termination' },
  { pattern: /\b(OR|AND)\s+\d+\s*=\s*\d+/i, name: 'tautology' },
  { pattern: /\b(UNION\s+(ALL\s+)?SELECT)\b/i, name: 'union_select' },
  { pattern: /\b(DROP|ALTER|TRUNCATE)\s+(TABLE|DATABASE)/i, name: 'destructive_ddl' },
];

export class DefaultArgsSanitizer implements ArgsSanitizer {
  private readonly config: ArgsValidatorConfig;

  constructor(config: Partial<ArgsValidatorConfig> = {}) {
    this.config = { ...DEFAULT_ARGS_VALIDATOR_CONFIG, ...config };
  }

  sanitize(_toolName: string, args: Record<string, unknown>): ArgsSanitizeResult {
    const violations: ArgsViolation[] = [];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        const stringViolations = this.checkString(key, value);
        violations.push(...stringViolations);
        sanitized[key] = this.sanitizeString(value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const nested = this.sanitize(key, value as Record<string, unknown>);
        sanitized[key] = nested.sanitized;
        violations.push(...(nested.violations ?? []));
      } else if (Array.isArray(value)) {
        const arr: unknown[] = [];
        for (const item of value) {
          if (typeof item === 'string') {
            const itemViolations = this.checkString(key, item);
            violations.push(...itemViolations);
            arr.push(this.sanitizeString(item));
          } else {
            arr.push(item);
          }
        }
        sanitized[key] = arr;
      } else {
        sanitized[key] = value;
      }
    }

    const result: ArgsSanitizeResult = {
      valid: violations.length === 0,
      sanitized,
    };
    if (violations.length > 0) {
      result.violations = violations;
    }
    return result;
  }

  private checkString(arg: string, value: string): ArgsViolation[] {
    const violations: ArgsViolation[] = [];

    if (this.config.checkPathTraversal) {
      for (const { pattern, name } of PATH_TRAVERSAL_PATTERNS) {
        if (pattern.test(value)) {
          violations.push({ type: 'path_traversal', arg, value, pattern: name });
        }
      }
    }

    if (this.config.checkCommandInjection) {
      for (const { pattern, name } of COMMAND_INJECTION_PATTERNS) {
        if (pattern.test(value)) {
          violations.push({ type: 'command_injection', arg, value, pattern: name });
        }
      }
    }

    if (this.config.checkSqlInjection) {
      for (const { pattern, name } of SQL_INJECTION_PATTERNS) {
        if (pattern.test(value)) {
          violations.push({ type: 'sql_injection', arg, value, pattern: name });
        }
      }
    }

    if (this.config.customPatterns) {
      for (const { name, pattern, type } of this.config.customPatterns) {
        if (pattern.test(value)) {
          violations.push({
            type: type === 'custom' ? 'custom' : type,
            arg,
            value,
            reason: type === 'custom' ? `Custom pattern matched: ${name}` : name,
          } as ArgsViolation);
        }
      }
    }

    return violations;
  }

  private sanitizeString(value: string): string {
    let result = value;
    if (this.config.checkCommandInjection) {
      result = result.replace(/[`$]/g, '\\$&');
    }
    if (this.config.checkPathTraversal) {
      result = result.replace(/\0/g, '');
    }
    return result;
  }
}

export interface ArgsSanitizer {
  sanitize(toolName: string, args: Record<string, unknown>): ArgsSanitizeResult;
}
