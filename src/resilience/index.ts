/**
 * Resilience Module - MPU-M4 异常熔断
 *
 * Re-exports all resilience components:
 * - ErrorClassifier: Error severity classification
 * - CircuitBreaker: Circuit breaker pattern
 * - AutoRepairer: Automatic error repair
 *
 * @module
 */

export { DefaultErrorClassifier } from './error-classifier.js';
export { DefaultCircuitBreaker } from './circuit-breaker.js';
export { DefaultAutoRepairer } from './auto-repairer.js';

// Re-export types from contracts
export type {
  ErrorSeverity,
  ErrorClassifier,
  CircuitBreakerState,
  CircuitBreakerConfig,
  CircuitBreaker,
  AutoRepairer,
  RepairResult,
  RepairHandler,
} from '../contracts/mpu-interfaces.js';
