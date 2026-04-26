/**
 * AgentForge Security Module
 *
 * @module
 */

// Permission
export {
  type PermissionDecision,
  type PermissionAskOptions,
  type PermissionPrompt,
  type PermissionController,
  DefaultPermissionController,
} from './permission/permission-controller.js';

export {
  type PolicyDecision,
  type PermissionPolicy,
  DEFAULT_PERMISSION_POLICY,
  evaluatePermission,
  createPermissionPolicy,
} from './permission/permission-policy.js';

export {
  type PermissionGuardContext,
  evaluatePermissionGuard,
  createPermissionDeniedEvents,
  createPermissionPromptEvent,
  createPermissionDecisionEvent,
  handlePermissionAsk,
} from './permission/permission-guard.js';

// Sanitization
export {
  type InputSanitizer,
  type InjectionCheckResult,
  type ValidationResult,
  type InputSanitizerConfig,
  DefaultInputSanitizer,
  DEFAULT_INPUT_SANITIZER_CONFIG,
} from './sanitization/input-sanitizer.js';

export {
  PathSanitizer,
  type PathAccessMode,
  type PathAccessResult,
  type PathSanitizerConfig,
  DEFAULT_DENIED_PATTERNS,
} from './sanitization/path-sanitizer.js';

export {
  type ArgsSanitizer,
  type ArgsViolation,
  type ArgsSanitizeResult,
  type ArgsValidatorConfig,
  DefaultArgsSanitizer,
  DEFAULT_ARGS_VALIDATOR_CONFIG,
} from './sanitization/argument-validator.js';

// Audit
export {
  type AuditEventType,
  type AuditEntry,
  type AuditFilter,
  type AuditLogger,
  type AuditLoggerConfig,
  DefaultAuditLogger,
} from './audit/audit-logger.js';

export { type AuditStore, InMemoryAuditStore } from './audit/audit-store.js';

export {
  type IntegrityHash,
  type IntegrityVerificationResult,
  computeEntryHash,
  buildHashChain,
  verifyIntegrityChain,
} from './audit/integrity.js';

// Sandbox
export {
  type SandboxCommand,
  type SandboxContext,
  type SandboxConfig,
  type SandboxResult,
  type SandboxViolation,
  type SandboxExecutor,
  DEFAULT_SANDBOX_CONFIG,
} from './sandbox/sandbox-executor.js';

export { InProcessSandboxExecutor } from './sandbox/in-process-sandbox.js';

// Rate Limit
export {
  type RateLimitConfig,
  type MultiDimensionalRateLimit,
  type RateLimiter,
  DEFAULT_RATE_LIMITS,
  InMemoryRateLimiter,
} from './rate-limit/rate-limiter.js';

export {
  type RateLimitStoreEntry,
  type RateLimitStore,
  InMemoryRateLimitStore,
} from './rate-limit/rate-limit-store.js';
