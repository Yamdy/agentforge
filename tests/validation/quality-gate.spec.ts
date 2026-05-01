/**
 * Unit tests for src/validation/quality-gate.ts
 *
 * Tests QualityGate with all 4 rule types, configuration,
 * blocking behavior, loop detection, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  QualityGate,
  DEFAULT_QUALITY_GATE_CONFIG,
  type QualityGateConfig,
  type QualityGateCheck,
} from '../../src/validation/quality-gate.js';
import type { AgentLoopState } from '../../src/core/state.js';

// ============================================================
// Test Helpers
// ============================================================

function createMockState(): AgentLoopState {
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    model: { provider: 'openai', model: 'gpt-4o' },
    messages: [],
    step: 0,
    maxSteps: 10,
    tokens: { prompt: 0, completion: 0 },
    output: '',
    recovery: {
      outputTokenEscalationCount: 0,
      recoveryMessageCount: 0,
      fallbackSwitchCount: 0,
      compactionRetryCount: 0,
    },
  } as AgentLoopState;
}

// ============================================================
// QualityGate Tests
// ============================================================

describe('QualityGate', () => {
  let gate: QualityGate;
  let state: AgentLoopState;

  beforeEach(() => {
    gate = new QualityGate();
    state = createMockState();
  });

  // ── Empty Response ──

  describe('empty_response', () => {
    it('should block empty string', () => {
      const result = gate.check('', state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('empty_response');
      expect(result.feedback).toBeDefined();
    });

    it('should block whitespace-only string', () => {
      const result = gate.check('   \n  \t  ', state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('empty_response');
    });

    it('should pass single character content', () => {
      const result = gate.check('x', state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('empty_response');
    });

    it('should pass normal text content', () => {
      const result = gate.check('The weather is sunny today.', state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('empty_response');
    });
  });

  // ── Hallucination Patterns ──

  describe('hallucination_pattern', () => {
    it('should detect "As an AI language model" pattern', () => {
      const gate = new QualityGate({ blockedReasons: ['empty_response', 'loop_detected', 'hallucination_pattern'] });
      const result = gate.check('As an AI language model, I can help you...', state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('hallucination_pattern');
    });

    it('should detect "I don\'t have real-time access" pattern', () => {
      const gate = new QualityGate({ blockedReasons: ['empty_response', 'loop_detected', 'hallucination_pattern'] });
      const result = gate.check('I don\'t have real-time access to current data.', state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('hallucination_pattern');
    });

    it('should detect "According to my training" pattern', () => {
      const gate = new QualityGate({ blockedReasons: ['empty_response', 'loop_detected', 'hallucination_pattern'] });
      const result = gate.check('According to my training data, the answer is 42.', state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('hallucination_pattern');
    });

    it('should detect "I am an AI" pattern', () => {
      const gate = new QualityGate({ blockedReasons: ['empty_response', 'loop_detected', 'hallucination_pattern'] });
      const result = gate.check('I am an AI assistant designed to help...', state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('hallucination_pattern');
    });

    it('should pass normal text without hallucination patterns', () => {
      const result = gate.check('The capital of France is Paris.', state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('hallucination_pattern');
    });

    it('should pass when detectHallucinationPatterns is disabled', () => {
      const strictGate = new QualityGate({ detectHallucinationPatterns: false });
      const result = strictGate.check('As an AI language model...', state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('hallucination_pattern');
    });

    it('should provide corrective feedback when blocked', () => {
      const gate = new QualityGate({ blockedReasons: ['empty_response', 'loop_detected', 'hallucination_pattern'] });
      const result = gate.check('I am a large language model...', state);
      expect(result.feedback).toBeDefined();
      expect(result.feedback).toContain('Avoid stating');
    });
  });

  // ── Loop Detection ──

  describe('loop_detected', () => {
    it('should pass on first unique response', () => {
      const result = gate.check('Let me analyze the code...', state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('loop_detected');
    });

    it('should pass on second different response', () => {
      gate.check('First response', state);
      const result = gate.check('Second different response', state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('loop_detected');
    });

    it('should detect 3 consecutive same responses', () => {
      const text = 'Let me analyze the code...';
      gate.check(text, state); // 1st
      gate.check(text, state); // 2nd
      const result = gate.check(text, state); // 3rd — should block
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('loop_detected');
      expect(result.feedback).toContain('stuck');
    });

    it('should reset loop detection after different response', () => {
      gate.check('Same text', state);
      gate.check('Same text', state);
      gate.check('Different text', state); // breaks the loop
      const result = gate.check('Different text', state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('loop_detected');
    });

    it('should respect custom maxLoopSimilarity', () => {
      const strictGate = new QualityGate({ maxLoopSimilarity: 2 });
      const text = 'Repeating...';
      strictGate.check(text, state); // 1st
      const result = strictGate.check(text, state); // 2nd — block at 2
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('loop_detected');
    });

    it('should normalize whitespace for hash comparison', () => {
      gate.check('Hello   world', state);
      gate.check('Hello world', state); // different whitespace but same content
      const result = gate.check('  Hello\tworld\n', state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('loop_detected');
    });
  });

  // ── Refusal Patterns ──

  describe('refusal_pattern', () => {
    it('should pass refusal patterns by default (disabled)', () => {
      const result = gate.check('I cannot help with that request.', state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('refusal_pattern');
    });

    it('should detect "I cannot help" when enabled', () => {
      const strictGate = new QualityGate({ detectRefusalPatterns: true });
      const result = strictGate.check('I cannot help with that request.', state);
      expect(result.passed).toBe(true); // not blocked by default blockedReasons
      expect(result.reasons).toContain('refusal_pattern');
    });

    it('should detect "I\'m not able to" when enabled', () => {
      const strictGate = new QualityGate({ detectRefusalPatterns: true });
      const result = strictGate.check("I'm not able to answer that question.", state);
      expect(result.reasons).toContain('refusal_pattern');
    });

    it('should detect "I\'m sorry, but I can\'t" when enabled', () => {
      const strictGate = new QualityGate({ detectRefusalPatterns: true });
      const result = strictGate.check("I'm sorry, but I can't comply with that.", state);
      expect(result.reasons).toContain('refusal_pattern');
    });

    it('should block when refusal is in blockedReasons', () => {
      const strictGate = new QualityGate({
        detectRefusalPatterns: true,
        blockedReasons: ['empty_response', 'loop_detected', 'refusal_pattern'],
      });
      const result = strictGate.check('I cannot help with that.', state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('refusal_pattern');
      expect(result.feedback).toBeDefined();
    });

    it('should pass normal text when refusal detection is enabled', () => {
      const strictGate = new QualityGate({ detectRefusalPatterns: true });
      const result = strictGate.check('Here is the answer to your question: 42.', state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('refusal_pattern');
    });
  });

  // ── Configuration ──

  describe('configuration', () => {
    it('should use DEFAULT_QUALITY_GATE_CONFIG by default', () => {
      expect(gate.getConfig()).toEqual(DEFAULT_QUALITY_GATE_CONFIG);
    });

    it('should merge partial config with defaults', () => {
      const custom = new QualityGate({ minContentLength: 10 });
      const cfg = custom.getConfig();
      expect(cfg.minContentLength).toBe(10);
      expect(cfg.maxLoopSimilarity).toBe(3); // default preserved
    });

    it('should update config at runtime via setConfig', () => {
      gate.setConfig({ maxLoopSimilarity: 5 });
      expect(gate.getConfig().maxLoopSimilarity).toBe(5);
    });

    it('should respect custom blockedReasons', () => {
      const permissive = new QualityGate({ blockedReasons: ['empty_response'] });
      const result = permissive.check('As an AI language model...', state);
      expect(result.passed).toBe(true); // hallucination not blocked
      expect(result.reasons).toContain('hallucination_pattern'); // still detected
    });

    it('should use custom minContentLength', () => {
      const strict = new QualityGate({ minContentLength: 50 });
      const result = strict.check('Short.', state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('empty_response');
    });
  });

  // ── reset() ──

  describe('reset', () => {
    it('should clear loop detection history', () => {
      const text = 'Looping text...';
      gate.check(text, state);
      gate.check(text, state);
      gate.reset();
      // After reset, should not detect loop on first check
      const result = gate.check(text, state);
      expect(result.passed).toBe(true);
      expect(result.reasons).not.toContain('loop_detected');
    });

    it('should clear hallucination match counters (same text retriggers)', () => {
      const gate = new QualityGate({ blockedReasons: ['empty_response', 'loop_detected', 'hallucination_pattern'] });
      const text = 'As an AI language model, I can help.';
      gate.check(text, state);  // 1st — blocked
      gate.reset();
      const reResult = gate.check(text, state);  // after reset — same text, should trigger fresh
      expect(reResult.passed).toBe(false);
      expect(reResult.reasons).toContain('hallucination_pattern');
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('should handle multiple simultaneous rules', () => {
      const strictGate = new QualityGate({
        detectRefusalPatterns: true,
        blockedReasons: ['empty_response', 'hallucination_pattern', 'loop_detected', 'refusal_pattern'],
      });
      const result = strictGate.check('As an AI language model, I cannot help with that.', state);
      expect(result.passed).toBe(false);
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    });

    it('should track reasons even when not blocking', () => {
      const permissiveGate = new QualityGate();
      const result = permissiveGate.check('As an AI language model...', state);
      // Detected but NOT blocked (hallucination not in default blockedReasons)
      expect(result.reasons).toContain('hallucination_pattern');
      expect(result.passed).toBe(true); // permissive: detected but not blocked
    });

    it('should pass normal varied conversation', () => {
      const responses = [
        'The file contains 42 lines of code.',
        'I can see 3 functions defined in this file.',
        'The error is on line 15 — missing semicolon.',
      ];
      for (const resp of responses) {
        const result = gate.check(resp, state);
        expect(result.passed).toBe(true);
        expect(result.reasons).toEqual([]);
      }
    });

    it('should handle very long content for hash', () => {
      const longText = 'a'.repeat(500);
      gate.check(longText, state);
      gate.check(longText, state);
      const result = gate.check(longText, state);
      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('loop_detected');
    });
  });
});
