/**
 * AskUserQuestionTool Tests
 *
 * Tests for the ask-user tool: prompting the user for input
 * with optional choices and multi-select support.
 */

import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '../../src/core/interfaces.js';

describe('AskUserQuestionTool', () => {
  let askTool: ToolDefinition;

  // ============================================================
  // Tool Metadata
  // ============================================================

  describe('tool metadata', () => {
    it('should have correct name', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      expect(askTool.name).toBe('ask_user_question');
    });

    it('should have a description', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      expect(askTool.description).toBeTruthy();
      expect(askTool.description.length).toBeGreaterThan(0);
    });

    it('should have Zod schema for parameters', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      expect(askTool.parameters).toBeDefined();
      expect(
        typeof (askTool.parameters as { parse?: unknown }).parse
      ).toBe('function');
    });

    it('should have requiresApproval set to false', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      expect(askTool.requiresApproval).toBe(false);
    });
  });

  // ============================================================
  // Question Formatting with Options
  // ============================================================

  describe('question with options', () => {
    it('should format question with single-choice options', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({
        question: 'What color do you prefer?',
        options: ['Red', 'Blue', 'Green'],
      });

      expect(result).toContain('What color do you prefer?');
      expect(result).toContain('Red');
      expect(result).toContain('Blue');
      expect(result).toContain('Green');
      expect(result).toMatch(/1\)|\[1\]|1\./); // Should have numbered/list format
    });

    it('should format question with many options', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({
        question: 'Pick a framework:',
        options: ['React', 'Vue', 'Angular', 'Svelte', 'Solid'],
      });

      expect(result).toContain('React');
      expect(result).toContain('Vue');
      expect(result).toContain('Angular');
      expect(result).toContain('Svelte');
      expect(result).toContain('Solid');
    });
  });

  // ============================================================
  // Question without Options
  // ============================================================

  describe('question without options', () => {
    it('should format a free-text question', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({
        question: 'What is your name?',
      });

      expect(result).toContain('What is your name?');
    });

    it('should not include options list when none provided', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({
        question: 'Simple question?',
      });

      // Should not have option markers like 1), [1], etc.
      expect(result).not.toMatch(/\d\)|\d\.\s+\w/);
    });
  });

  // ============================================================
  // Multi-Select Support
  // ============================================================

  describe('multiSelect', () => {
    it('should indicate multi-select when enabled', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({
        question: 'Select all that apply:',
        options: ['Option A', 'Option B', 'Option C'],
        multiSelect: true,
      });

      expect(result).toContain('Option A');
      expect(result).toContain('Option B');
      expect(result).toContain('Option C');
      // Should mention multi-select capability
      expect(result).toContain("Select one or more — e.g. '1, 3'");
    });

    it('should default to single-select when multiSelect is false', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({
        question: 'Choose one:',
        options: ['X', 'Y', 'Z'],
        multiSelect: false,
      });

      expect(result).toContain('X');
      expect(result).toContain('Y');
      expect(result).toContain('Z');
      // Should use single-select instruction
      expect(result).toContain('(Select one option)');
      // Should NOT mention multi-select
      expect(result).not.toMatch(/multiple|select.all|multi/i);
    });
  });

  // ============================================================
  // HITL Context Handling
  // ============================================================

  describe('HITL context', () => {
    it('should format question when context has parentSessionId', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute(
        {
          question: 'Do you approve this action?',
          options: ['Yes', 'No'],
        },
        {
          toolCallId: 'tc-001',
          parentSessionId: 'session-abc-123',
        }
      );

      // With HITL context, should return formatted question
      expect(result).toContain('Do you approve this action?');
      expect(result).toContain('Yes');
      expect(result).toContain('No');
    });

    it('should return interactive placeholder when no context', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({
        question: 'Do you approve?',
      });

      // Without HITL context, should indicate interactive mode
      expect(result).toMatch(/interactive|sent.to.user|prompt|display/i);
    });

    it('should return interactive placeholder when context has no parentSessionId', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute(
        {
          question: 'What now?',
        },
        {
          toolCallId: 'tc-002',
          parentSessionId: '',
        }
      );

      // Empty parentSessionId treated as no HITL
      expect(result).toMatch(/interactive|sent.to.user|prompt|display/i);
    });
  });

  // ============================================================
  // Input Validation
  // ============================================================

  describe('input validation', () => {
    it('should reject missing question field', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({});

      expect(result).toContain('Error');
    });

    it('should handle empty question string gracefully', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({ question: '' });

      // Empty question is valid per Zod; tool should still format it without error
      expect(result).not.toContain('Error');
      expect(result).toContain('Question');
    });

    it('should handle empty options array', async () => {
      const { createAskUserQuestionTool } = await import(
        '../../src/tools/ask-user.js'
      );
      askTool = createAskUserQuestionTool();

      const result = await askTool.execute({
        question: 'What do you think?',
        options: [],
      });

      // Empty options should be treated as no options
      expect(result).toContain('What do you think?');
    });
  });
});
