/**
 * Unit tests for src/core/state-machine.ts
 *
 * Tests AgentStateMachine class with 6-state model and transition validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  type AgentStateEnum,
  AGENT_STATES,
  AgentStateMachine,
  isValidTransition,
  getValidTransitions,
} from '../../src/core/state-machine.js';

// ============================================================
// AgentStateMachine Tests
// ============================================================

describe('AgentStateMachine', () => {
  let machine: AgentStateMachine;

  beforeEach(() => {
    machine = new AgentStateMachine();
  });

  // --------------------------------------------------------
  // Initial State
  // --------------------------------------------------------

  describe('initial state', () => {
    it('should start with pending state', () => {
      expect(machine.state).toBe('pending');
    });

    it('should not be terminal initially', () => {
      expect(machine.isTerminal()).toBe(false);
    });
  });

  // --------------------------------------------------------
  // Valid Transitions
  // --------------------------------------------------------

  describe('valid transitions', () => {
    it('should allow pending → running', () => {
      const result = machine.transition('running');
      expect(result).toBe(true);
      expect(machine.state).toBe('running');
    });

    it('should allow running → paused', () => {
      machine.transition('running');
      const result = machine.transition('paused');
      expect(result).toBe(true);
      expect(machine.state).toBe('paused');
    });

    it('should allow paused → running', () => {
      machine.transition('running');
      machine.transition('paused');
      const result = machine.transition('running');
      expect(result).toBe(true);
      expect(machine.state).toBe('running');
    });

    it('should allow running → completed', () => {
      machine.transition('running');
      const result = machine.transition('completed');
      expect(result).toBe(true);
      expect(machine.state).toBe('completed');
    });

    it('should allow running → cancelled', () => {
      machine.transition('running');
      const result = machine.transition('cancelled');
      expect(result).toBe(true);
      expect(machine.state).toBe('cancelled');
    });

    it('should allow running → error', () => {
      machine.transition('running');
      const result = machine.transition('error');
      expect(result).toBe(true);
      expect(machine.state).toBe('error');
    });

    it('should allow paused → cancelled', () => {
      machine.transition('running');
      machine.transition('paused');
      const result = machine.transition('cancelled');
      expect(result).toBe(true);
      expect(machine.state).toBe('cancelled');
    });
  });

  // --------------------------------------------------------
  // Invalid Transitions
  // --------------------------------------------------------

  describe('invalid transitions', () => {
    it('should reject pending → completed', () => {
      const result = machine.transition('completed');
      expect(result).toBe(false);
      expect(machine.state).toBe('pending');
    });

    it('should reject pending → paused', () => {
      const result = machine.transition('paused');
      expect(result).toBe(false);
      expect(machine.state).toBe('pending');
    });

    it('should reject pending → cancelled', () => {
      const result = machine.transition('cancelled');
      expect(result).toBe(false);
      expect(machine.state).toBe('pending');
    });

    it('should reject pending → error', () => {
      const result = machine.transition('error');
      expect(result).toBe(false);
      expect(machine.state).toBe('pending');
    });

    it('should reject running → pending', () => {
      machine.transition('running');
      const result = machine.transition('pending');
      expect(result).toBe(false);
      expect(machine.state).toBe('running');
    });

    it('should reject paused → completed', () => {
      machine.transition('running');
      machine.transition('paused');
      const result = machine.transition('completed');
      expect(result).toBe(false);
      expect(machine.state).toBe('paused');
    });

    it('should reject paused → error', () => {
      machine.transition('running');
      machine.transition('paused');
      const result = machine.transition('error');
      expect(result).toBe(false);
      expect(machine.state).toBe('paused');
    });
  });

  // --------------------------------------------------------
  // Terminal States
  // --------------------------------------------------------

  describe('terminal states', () => {
    it('completed should be terminal', () => {
      machine.transition('running');
      machine.transition('completed');
      expect(machine.isTerminal()).toBe(true);
    });

    it('cancelled should be terminal', () => {
      machine.transition('running');
      machine.transition('cancelled');
      expect(machine.isTerminal()).toBe(true);
    });

    it('error should be terminal', () => {
      machine.transition('running');
      machine.transition('error');
      expect(machine.isTerminal()).toBe(true);
    });

    it('pending should not be terminal', () => {
      expect(machine.isTerminal()).toBe(false);
    });

    it('running should not be terminal', () => {
      machine.transition('running');
      expect(machine.isTerminal()).toBe(false);
    });

    it('paused should not be terminal', () => {
      machine.transition('running');
      machine.transition('paused');
      expect(machine.isTerminal()).toBe(false);
    });

    it('completed should reject all transitions', () => {
      machine.transition('running');
      machine.transition('completed');

      const states: AgentStateEnum[] = ['pending', 'running', 'paused', 'completed', 'cancelled', 'error'];
      for (const targetState of states) {
        const result = machine.transition(targetState);
        expect(result).toBe(false);
        expect(machine.state).toBe('completed');
      }
    });

    it('cancelled should reject all transitions', () => {
      machine.transition('running');
      machine.transition('cancelled');

      const states: AgentStateEnum[] = ['pending', 'running', 'paused', 'completed', 'cancelled', 'error'];
      for (const targetState of states) {
        const result = machine.transition(targetState);
        expect(result).toBe(false);
        expect(machine.state).toBe('cancelled');
      }
    });

    it('error should reject all transitions', () => {
      machine.transition('running');
      machine.transition('error');

      const states: AgentStateEnum[] = ['pending', 'running', 'paused', 'completed', 'cancelled', 'error'];
      for (const targetState of states) {
        const result = machine.transition(targetState);
        expect(result).toBe(false);
        expect(machine.state).toBe('error');
      }
    });
  });

  // --------------------------------------------------------
  // onChange Listener
  // --------------------------------------------------------

  describe('onChange listener', () => {
    it('should be called on valid transition', () => {
      let callCount = 0;
      machine.onChange(() => {
        callCount++;
      });

      machine.transition('running');
      expect(callCount).toBe(1);
    });

    it('should receive correct from/to states', () => {
      let receivedFrom: AgentStateEnum | undefined;
      let receivedTo: AgentStateEnum | undefined;

      machine.onChange((from, to) => {
        receivedFrom = from;
        receivedTo = to;
      });

      machine.transition('running');
      expect(receivedFrom).toBe('pending');
      expect(receivedTo).toBe('running');

      machine.transition('paused');
      expect(receivedFrom).toBe('running');
      expect(receivedTo).toBe('paused');
    });

    it('should not be called on invalid transition', () => {
      let callCount = 0;
      machine.onChange(() => {
        callCount++;
      });

      machine.transition('completed'); // Invalid from pending
      expect(callCount).toBe(0);
    });

    it('should not be called on transition from terminal state', () => {
      let callCount = 0;
      machine.onChange(() => {
        callCount++;
      });

      machine.transition('running');
      machine.transition('completed');
      expect(callCount).toBe(2);

      machine.transition('running'); // Invalid from completed
      expect(callCount).toBe(2); // Still 2, no new call
    });

    it('should support multiple listeners', () => {
      const calls: string[] = [];

      machine.onChange(() => calls.push('listener1'));
      machine.onChange(() => calls.push('listener2'));

      machine.transition('running');
      expect(calls).toEqual(['listener1', 'listener2']);
    });

    it('should allow unsubscribe', () => {
      let callCount = 0;
      const unsubscribe = machine.onChange(() => {
        callCount++;
      });

      machine.transition('running');
      expect(callCount).toBe(1);

      unsubscribe();

      machine.transition('paused');
      expect(callCount).toBe(1); // Still 1, listener removed
    });

    it('should handle unsubscribe during notification', () => {
      const calls: string[] = [];
      let unsubscribe: (() => void) | undefined;

      unsubscribe = machine.onChange(() => {
        calls.push('listener');
        if (unsubscribe) {
          unsubscribe();
        }
      });

      machine.transition('running');
      expect(calls).toEqual(['listener']);

      // Second transition should not trigger listener
      machine.transition('paused');
      expect(calls).toEqual(['listener']);
    });

    it('should swallow listener errors', () => {
      let callCount = 0;

      machine.onChange(() => {
        callCount++;
        throw new Error('Listener error');
      });

      // Should not throw
      const result = machine.transition('running');
      expect(result).toBe(true);
      expect(callCount).toBe(1);
      expect(machine.state).toBe('running');
    });

    it('should continue to other listeners after one throws', () => {
      const calls: string[] = [];

      machine.onChange(() => {
        calls.push('listener1');
        throw new Error('Listener 1 error');
      });
      machine.onChange(() => {
        calls.push('listener2');
      });

      machine.transition('running');
      expect(calls).toEqual(['listener1', 'listener2']);
    });
  });

  // --------------------------------------------------------
  // Reset
  // --------------------------------------------------------

  describe('reset', () => {
    it('should return to pending state', () => {
      machine.transition('running');
      machine.transition('completed');
      expect(machine.state).toBe('completed');

      machine.reset();
      expect(machine.state).toBe('pending');
    });

    it('should clear listeners', () => {
      let callCount = 0;
      machine.onChange(() => callCount++);

      machine.transition('running');
      expect(callCount).toBe(1);

      machine.reset();

      machine.transition('running');
      expect(callCount).toBe(1); // Still 1, listeners cleared
    });

    it('should allow fresh start after reset', () => {
      machine.transition('running');
      machine.transition('completed');

      machine.reset();

      // Should be able to transition again
      expect(machine.state).toBe('pending');
      expect(machine.isTerminal()).toBe(false);

      const result = machine.transition('running');
      expect(result).toBe(true);
      expect(machine.state).toBe('running');
    });
  });
});

// ============================================================
// Helper Functions Tests
// ============================================================

describe('isValidTransition', () => {
  it('should return true for valid transitions', () => {
    expect(isValidTransition('pending', 'running')).toBe(true);
    expect(isValidTransition('running', 'paused')).toBe(true);
    expect(isValidTransition('running', 'completed')).toBe(true);
    expect(isValidTransition('running', 'cancelled')).toBe(true);
    expect(isValidTransition('running', 'error')).toBe(true);
    expect(isValidTransition('paused', 'running')).toBe(true);
    expect(isValidTransition('paused', 'cancelled')).toBe(true);
  });

  it('should return false for invalid transitions', () => {
    expect(isValidTransition('pending', 'completed')).toBe(false);
    expect(isValidTransition('pending', 'paused')).toBe(false);
    expect(isValidTransition('pending', 'cancelled')).toBe(false);
    expect(isValidTransition('pending', 'error')).toBe(false);
    expect(isValidTransition('running', 'pending')).toBe(false);
    expect(isValidTransition('paused', 'completed')).toBe(false);
    expect(isValidTransition('paused', 'error')).toBe(false);
  });

  it('should return false for all transitions from terminal states', () => {
    const terminalStates: AgentStateEnum[] = ['completed', 'cancelled', 'error'];
    const allStates: AgentStateEnum[] = ['pending', 'running', 'paused', 'completed', 'cancelled', 'error'];

    for (const terminal of terminalStates) {
      for (const target of allStates) {
        expect(isValidTransition(terminal, target)).toBe(false);
      }
    }
  });
});

describe('getValidTransitions', () => {
  it('should return correct transitions for pending', () => {
    const transitions = getValidTransitions('pending');
    expect(transitions).toEqual(['running']);
  });

  it('should return correct transitions for running', () => {
    const transitions = getValidTransitions('running');
    expect(transitions).toEqual(['paused', 'completed', 'cancelled', 'error']);
  });

  it('should return correct transitions for paused', () => {
    const transitions = getValidTransitions('paused');
    expect(transitions).toEqual(['running', 'cancelled']);
  });

  it('should return empty array for completed', () => {
    const transitions = getValidTransitions('completed');
    expect(transitions).toEqual([]);
  });

  it('should return empty array for cancelled', () => {
    const transitions = getValidTransitions('cancelled');
    expect(transitions).toEqual([]);
  });

  it('should return empty array for error', () => {
    const transitions = getValidTransitions('error');
    expect(transitions).toEqual([]);
  });

  it('should return frozen array for every valid state', () => {
    for (const state of AGENT_STATES) {
      const t = getValidTransitions(state);
      expect(Array.isArray(t)).toBe(true);
      expect(Object.isFrozen(t)).toBe(true);
    }
  });
});
