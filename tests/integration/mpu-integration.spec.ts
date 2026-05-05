/**
 * MPU Integration Tests
 *
 * Tests integration of MPU modules into AgentContext and ApplicationServices
 * via ContextBuilder and createMPUServices factory.
 *
 * @see src/core/context.ts - ApplicationServices, AgentContext
 * @see src/api/context-builder.ts - AgentContextBuilder
 * @see src/integration/mpu-config.ts - MPUConfig, createMPUServices
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentContextBuilder } from '../../src/api/context-builder.js';
import { createMPUServices, type MPUConfig } from '../../src/integration/mpu-config.js';
import { SecurityGuard } from '../../src/security/guard.js';
import type { ErrorClassifier } from '../../src/contracts/mpu-interfaces.js';
import type { CircuitBreaker } from '../../src/contracts/mpu-interfaces.js';
import type { Planner } from '../../src/planning/types.js';
import type { HealthChecker } from '../../src/contracts/mpu-interfaces.js';
import type { AuditStore } from '../../src/contracts/mpu-interfaces.js';
import type { CostTracker } from '../../src/contracts/mpu-interfaces.js';
import type { MetricsCollector } from '../../src/contracts/mpu-interfaces.js';
import type { ResultValidator } from '../../src/contracts/mpu-interfaces.js';

// ============================================================
// Test Helpers - Minimal mock implementations
// ============================================================

function createMockLLMAdapter() {
  return {
    chat: async () => ({
      content: 'mock',
      finishReason: 'stop' as const,
      usage: { promptTokens: 0, completionTokens: 0 },
    }),
    streamChat: async function* () {
      yield { type: 'text_delta' as const, content: 'mock' };
    },
  };
}

function createMockToolRegistry() {
  return {
    list: () => [],
    has: () => false,
    get: () => {
      throw new Error('Tool not found');
    },
    getFunctionDef: () => {
      throw new Error('Tool not found');
    },
    getFunctionDefs: () => [],
    execute: async () => {
      throw new Error('Tool not found');
    },
    register: () => {},
    registerAll: () => {},
  };
}

function createMockErrorClassifier(): ErrorClassifier {
  return {
    classify: () => 'minor' as const,
  };
}

function createMockCircuitBreaker(): CircuitBreaker {
  return {
    recordFailure: () => false,
    shouldTrip: () => false,
    reset: () => {},
    getState: () => 'closed' as const,
    getFailureCount: () => 0,
  };
}

function createMockPlanner(): Planner {
  return {
    plan: async () => ({
      id: 'plan-1',
      steps: [],
      createdAt: Date.now(),
    }),
    validate: async () => ({
      valid: true,
      errors: [],
    }),
  };
}

function createMockHealthChecker(): HealthChecker {
  return {
    check: async () => ({
      status: 'healthy' as const,
      version: '1.0.0',
      uptime: 0,
      checks: [],
    }),
    ready: async () => ({
      ready: true,
    }),
    registerCheck: () => {},
  };
}

function createMockAuditStore(): AuditStore {
  return {
    append: async () => {},
    query: async () => [],
    verifyIntegrity: async () => ({
      valid: true,
      totalEntries: 0,
    }),
    export: async () => '',
    count: async () => 0,
  };
}

function createMockCostTracker(): CostTracker {
  return {
    record: async () => {},
    getUsage: async () => ({
      sessionId: '',
      totalCost: 0,
      byModel: {},
      byTool: {},
      timeRange: { start: '', end: '' },
    }),
    checkLimit: async () => ({
      withinLimit: true,
      current: {
        sessionId: '',
        totalCost: 0,
        byModel: {},
        byTool: {},
        timeRange: { start: '', end: '' },
      },
      limit: {},
    }),
    setLimit: async () => {},
    getLimit: async () => null,
    reset: async () => {},
  };
}

function createMockMetricsCollector(): MetricsCollector {
  return {
    incrementCounter: () => {},
    recordHistogram: () => {},
    recordGauge: () => {},
    getMetrics: async () => '',
    reset: () => {},
  };
}

function createMockResultValidator(): ResultValidator {
  return {
    validate: () => ({ valid: true, errors: [] }),
    registerSchema: () => {},
    removeSchema: () => {},
  };
}

// ============================================================
// ============================================================

describe('MPU Integration', () => {
  describe('ContextBuilder should support withSecurityGuard', () => {
    it('should accept a SecurityGuard and include it in the built context', () => {
      const guard = new SecurityGuard();

      const ctx = AgentContextBuilder.create()
        .with({ llm: createMockLLMAdapter() as any, tools: [], securityGuard: guard })
        .build();

      expect(ctx.securityGuard).toBe(guard);
    });
  });

  // ============================================================
    // ============================================================

  describe('ContextBuilder should support withErrorClassifier', () => {
    it('should accept an ErrorClassifier and include it in the built context', () => {
      const classifier = createMockErrorClassifier();

      const ctx = AgentContextBuilder.create()
        .with({ llm: createMockLLMAdapter() as any, tools: [], errorClassifier: classifier })
        .build();

      expect(ctx.errorClassifier).toBe(classifier);
    });
  });

  // ============================================================
    // ============================================================

  describe('ContextBuilder should support withCircuitBreaker', () => {
    it('should accept a CircuitBreaker and include it in the built context', () => {
      const breaker = createMockCircuitBreaker();

      const ctx = AgentContextBuilder.create()
        .with({ llm: createMockLLMAdapter() as any, tools: [], circuitBreaker: breaker })
        .build();

      expect(ctx.circuitBreaker).toBe(breaker);
    });
  });

  // ============================================================
    // ============================================================

  describe('ContextBuilder should support withPlanner', () => {
    it('should accept a Planner and include it in the built context', () => {
      const planner = createMockPlanner();

      const ctx = AgentContextBuilder.create()
        .with({ llm: createMockLLMAdapter() as any, tools: [], planner })
        .build();

      expect(ctx.planner).toBe(planner);
    });
  });

  // ============================================================
    // ============================================================

  describe('dependencies should be undefined when not configured', () => {
    it('should leave all MPU fields undefined when not set', () => {
      const ctx = AgentContextBuilder.create()
        .with({ llm: createMockLLMAdapter() as any, tools: [] })
        .build();

      expect(ctx.securityGuard).toBeUndefined();
      expect(ctx.errorClassifier).toBeUndefined();
      expect(ctx.circuitBreaker).toBeUndefined();
      expect(ctx.planner).toBeUndefined();
    });
  });

  // ============================================================
    // ============================================================

  describe('createMPUServices should create services based on config', () => {
    it('should create health checker when enableHealthCheck is true', () => {
      const result = createMPUServices({ enableHealthCheck: true });

      expect(result.services.healthChecker).toBeDefined();
      expect(typeof result.services.healthChecker!.check).toBe('function');
      expect(typeof result.services.healthChecker!.ready).toBe('function');
      expect(typeof result.services.healthChecker!.registerCheck).toBe('function');
    });

    it('should create audit store when enableAudit is true', () => {
      const result = createMPUServices({ enableAudit: true });

      expect(result.services.auditStore).toBeDefined();
      expect(typeof result.services.auditStore!.append).toBe('function');
      expect(typeof result.services.auditStore!.query).toBe('function');
    });

    it('should create cost tracker when enableCostTracking is true', () => {
      const result = createMPUServices({ enableCostTracking: true });

      expect(result.services.costTracker).toBeDefined();
      expect(typeof result.services.costTracker!.record).toBe('function');
      expect(typeof result.services.costTracker!.checkLimit).toBe('function');
    });

    it('should create metrics collector when enableHealthCheck is true', () => {
      const result = createMPUServices({ enableHealthCheck: true });

      expect(result.services.metricsCollector).toBeDefined();
      expect(typeof result.services.metricsCollector!.incrementCounter).toBe('function');
    });

    it('should create result validator when enableResultValidation is true', () => {
      const result = createMPUServices({ enableResultValidation: true });

      expect(result.services.resultValidator).toBeDefined();
      expect(typeof result.services.resultValidator!.validate).toBe('function');
    });

    it('should create security guard when enableSecurity is true', () => {
      const result = createMPUServices({ enableSecurity: true });

      expect(result.context.securityGuard).toBeDefined();
      expect(typeof result.context.securityGuard!.checkCommand).toBe('function');
      expect(typeof result.context.securityGuard!.checkPath).toBe('function');
      expect(typeof result.context.securityGuard!.checkNetwork).toBe('function');
    });

    it('should create circuit breaker when enableCircuitBreaker is true', () => {
      const result = createMPUServices({ enableCircuitBreaker: true });

      expect(result.context.circuitBreaker).toBeDefined();
      expect(typeof result.context.circuitBreaker!.getState).toBe('function');
    });

    it('should create error classifier when enableCircuitBreaker is true', () => {
      const result = createMPUServices({ enableCircuitBreaker: true });

      expect(result.context.errorClassifier).toBeDefined();
      expect(typeof result.context.errorClassifier!.classify).toBe('function');
    });

    it('should create planner when enablePlanning is true', () => {
      const result = createMPUServices({ enablePlanning: true });

      expect(result.context.planner).toBeDefined();
      expect(typeof result.context.planner!.plan).toBe('function');
      expect(typeof result.context.planner!.validate).toBe('function');
    });
  });

  // ============================================================
    // ============================================================

  describe('createMPUServices should not create services when disabled', () => {
    it('should return empty services and context when all flags are false', () => {
      const result = createMPUServices({
        enableHealthCheck: false,
        enableAudit: false,
        enableSecurity: false,
        enableCircuitBreaker: false,
        enablePlanning: false,
        enableCostTracking: false,
        enableResultValidation: false,
      });

      expect(result.services.healthChecker).toBeUndefined();
      expect(result.services.auditStore).toBeUndefined();
      expect(result.services.costTracker).toBeUndefined();
      expect(result.services.metricsCollector).toBeUndefined();
      expect(result.services.resultValidator).toBeUndefined();
      expect(result.context.securityGuard).toBeUndefined();
      expect(result.context.errorClassifier).toBeUndefined();
      expect(result.context.circuitBreaker).toBeUndefined();
      expect(result.context.planner).toBeUndefined();
    });

    it('should return empty services and context with empty config', () => {
      const result = createMPUServices({});

      expect(result.services.healthChecker).toBeUndefined();
      expect(result.services.auditStore).toBeUndefined();
      expect(result.services.costTracker).toBeUndefined();
      expect(result.services.metricsCollector).toBeUndefined();
      expect(result.services.resultValidator).toBeUndefined();
      expect(result.context.securityGuard).toBeUndefined();
      expect(result.context.errorClassifier).toBeUndefined();
      expect(result.context.circuitBreaker).toBeUndefined();
      expect(result.context.planner).toBeUndefined();
    });
  });

  // ============================================================
    // ============================================================

  describe('ApplicationServices should support health checker', () => {
    it('should allow setting healthChecker on ApplicationServices', () => {
      const mockHealthChecker = createMockHealthChecker();
      const result = createMPUServices({ enableHealthCheck: true });

      expect(result.services.healthChecker).toBeDefined();

      // Verify it satisfies the HealthChecker interface
      const hc = result.services.healthChecker!;
      expect(hc.check).toBeDefined();
      expect(hc.ready).toBeDefined();
      expect(hc.registerCheck).toBeDefined();
    });
  });

  // ============================================================
    // ============================================================

  describe('ApplicationServices should support audit store', () => {
    it('should allow setting auditStore on ApplicationServices', () => {
      const result = createMPUServices({ enableAudit: true });

      expect(result.services.auditStore).toBeDefined();

      // Verify it satisfies the AuditStore interface
      const store = result.services.auditStore!;
      expect(store.append).toBeDefined();
      expect(store.query).toBeDefined();
      expect(store.verifyIntegrity).toBeDefined();
      expect(store.export).toBeDefined();
      expect(store.count).toBeDefined();
    });
  });

  // ============================================================
    // ============================================================

  describe('ApplicationServices should support cost tracking', () => {
    it('should allow setting costTracker on ApplicationServices', () => {
      const result = createMPUServices({ enableCostTracking: true });

      expect(result.services.costTracker).toBeDefined();

      // Verify it satisfies the CostTracker interface
      const tracker = result.services.costTracker!;
      expect(tracker.record).toBeDefined();
      expect(tracker.getUsage).toBeDefined();
      expect(tracker.checkLimit).toBeDefined();
      expect(tracker.setLimit).toBeDefined();
      expect(tracker.getLimit).toBeDefined();
      expect(tracker.reset).toBeDefined();
    });
  });

  // ============================================================
  // Additional: Builder chain methods should support fluent chaining
  // ============================================================

  describe('Builder chain methods should support fluent chaining', () => {
    it('should support chaining multiple MPU methods together', () => {
      const guard = new SecurityGuard();
      const classifier = createMockErrorClassifier();
      const breaker = createMockCircuitBreaker();
      const planner = createMockPlanner();

      const ctx = AgentContextBuilder.create()
        .with({
          llm: createMockLLMAdapter() as any,
          tools: [],
          securityGuard: guard,
          errorClassifier: classifier,
          circuitBreaker: breaker,
          planner,
        })
        .build();

      expect(ctx.securityGuard).toBe(guard);
      expect(ctx.errorClassifier).toBe(classifier);
      expect(ctx.circuitBreaker).toBe(breaker);
      expect(ctx.planner).toBe(planner);
    });
  });

  // ============================================================
  // Additional: Integration with ContextBuilder
  // ============================================================

  describe('createMPUServices integrates with AgentContextBuilder', () => {
    it('should create MPU services and apply them via builder', () => {
      const mpu = createMPUServices({
        enableSecurity: true,
        enableCircuitBreaker: true,
        enablePlanning: true,
      });

      const ctx = AgentContextBuilder.create()
        .with({
          llm: createMockLLMAdapter() as any,
          tools: [],
          securityGuard: mpu.context.securityGuard!,
          errorClassifier: mpu.context.errorClassifier!,
          circuitBreaker: mpu.context.circuitBreaker!,
          planner: mpu.context.planner!,
        })
        .build();

      expect(ctx.securityGuard).toBeDefined();
      expect(ctx.errorClassifier).toBeDefined();
      expect(ctx.circuitBreaker).toBeDefined();
      expect(ctx.planner).toBeDefined();
    });
  });
});
