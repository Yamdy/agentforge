/**
 * Unit tests for src/core/prompt-builder.ts
 *
 * Tests DefaultPromptBuilder and template rendering.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  DefaultPromptBuilder,
  DEFAULT_SYSTEM_TEMPLATE,
  TOOL_INSTRUCTIONS_TEMPLATE,
} from '../../src/core/prompt-builder.js';
import type { Message, ToolDefinition } from '../../src/core/interfaces.js';

// ============================================================
// DefaultPromptBuilder
// ============================================================

describe('DefaultPromptBuilder', () => {
  const builder = new DefaultPromptBuilder();

  // Helper: create a tool definition
  function makeTool(
    name: string,
    description: string,
    schema: z.ZodTypeAny,
  ): ToolDefinition<z.ZodTypeAny> {
    return {
      name,
      description,
      parameters: schema,
      execute: async () => 'result',
    };
  }

  describe('build - basic', () => {
    it('builds prompt with system template', () => {
      const result = builder.build([], 'Hello', []);

      expect(result.messages.length).toBe(2); // system + user
      expect(result.messages[0]?.role).toBe('system');
      expect(result.messages[1]?.role).toBe('user');
      expect(result.messages[1]?.content).toBe('Hello');
    });

    it('includes history in message array', () => {
      const history: Message[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ];

      const result = builder.build(history, 'How are you?', []);

      // system + history + user
      expect(result.messages.length).toBe(4);
      expect(result.messages[0]?.role).toBe('system');
      expect(result.messages[1]?.role).toBe('user');
      expect(result.messages[1]?.content).toBe('Hi');
      expect(result.messages[2]?.role).toBe('assistant');
      expect(result.messages[2]?.content).toBe('Hello!');
      expect(result.messages[3]?.role).toBe('user');
      expect(result.messages[3]?.content).toBe('How are you?');
    });
  });

  describe('build - tool instructions', () => {
    it('includes tool instructions when tools present', () => {
      const tool = makeTool(
        'weather',
        'Get weather for a city',
        z.object({ city: z.string() }),
      );

      const result = builder.build([], 'What is the weather?', [tool]);

      const systemContent = result.messages[0]?.content ?? '';
      expect(systemContent).toContain('weather');
      expect(systemContent).toContain('Get weather for a city');
    });

    it('does not include tool instructions when no tools', () => {
      const result = builder.build([], 'Hello', []);

      const systemContent = result.messages[0]?.content ?? '';
      // Tool instructions template should not appear with content
      expect(systemContent).not.toContain('You have access to the following tools');
    });

    it('converts Zod tools to FunctionDefinition', () => {
      const tool = makeTool(
        'calculator',
        'Calculate expression',
        z.object({ expression: z.string() }),
      );

      const result = builder.build([], 'Calculate 2+2', [tool]);

      expect(result.tools.length).toBe(1);
      expect(result.tools[0]?.name).toBe('calculator');
      expect(result.tools[0]?.description).toBe('Calculate expression');
      expect(result.tools[0]?.parameters.type).toBe('object');
      expect(result.tools[0]?.parameters.properties).toEqual({
        expression: { type: 'string' },
      });
    });

    it('empty tools list produces no tool definitions', () => {
      const result = builder.build([], 'Hello', []);
      expect(result.tools).toEqual([]);
    });
  });

  describe('build - template variables', () => {
    it('template variable interpolation works', () => {
      const result = builder.build([], 'Hello', [], {
        systemTemplate: 'You are {{role}}. {{task}}',
        templateVars: {
          role: 'a coding assistant',
          task: 'Help with code.',
        },
      });

      const systemContent = result.messages[0]?.content ?? '';
      expect(systemContent).toContain('a coding assistant');
      expect(systemContent).toContain('Help with code.');
    });

    it('replaces unknown template vars with empty string', () => {
      const result = builder.build([], 'Hello', [], {
        systemTemplate: 'Hello {{unknownVar}} world',
      });

      const systemContent = result.messages[0]?.content ?? '';
      expect(systemContent).toBe('Hello  world');
    });
  });

  describe('build - extra instructions', () => {
    it('appends extra instructions correctly', () => {
      const result = builder.build([], 'Hello', [], {
        extraInstructions: [
          'Always respond in French.',
          'Be concise.',
        ],
      });

      const systemContent = result.messages[0]?.content ?? '';
      expect(systemContent).toContain('Always respond in French.');
      expect(systemContent).toContain('Be concise.');
    });

    it('handles single extra instruction', () => {
      const result = builder.build([], 'Hello', [], {
        extraInstructions: ['Be polite.'],
      });

      const systemContent = result.messages[0]?.content ?? '';
      expect(systemContent).toContain('Be polite.');
    });
  });

  describe('build - token estimation', () => {
    it('token estimate is reasonable', () => {
      const result = builder.build([], 'Hello world', []);

      // Token estimate should be based on chars/4
      const totalChars = result.messages.reduce(
        (sum, msg) => sum + msg.content.length,
        0,
      );
      const expectedEstimate = Math.ceil(totalChars / 4);

      expect(result.tokenEstimate).toBe(expectedEstimate);
      expect(result.tokenEstimate).toBeGreaterThan(0);
    });

    it('token estimate accounts for longer messages', () => {
      const shortResult = builder.build([], 'Hi', []);
      const longResult = builder.build(
        [],
        'This is a much longer input that should result in more estimated tokens',
        [],
      );

      expect(longResult.tokenEstimate).toBeGreaterThan(shortResult.tokenEstimate);
    });
  });

  describe('build - custom system template', () => {
    it('uses custom system template when provided', () => {
      const result = builder.build([], 'Hello', [], {
        systemTemplate: 'Custom: {{customInstructions}} {{toolInstructions}}',
      });

      const systemContent = result.messages[0]?.content ?? '';
      expect(systemContent).toContain('Custom:');
    });

    it('uses default system template when not provided', () => {
      const result = builder.build([], 'Hello', []);

      const systemContent = result.messages[0]?.content ?? '';
      expect(systemContent).toContain('helpful AI assistant');
    });
  });

  describe('build - combined features', () => {
    it('handles tools + extra instructions + template vars together', () => {
      const tool = makeTool(
        'search',
        'Search the web',
        z.object({ query: z.string() }),
      );

      const result = builder.build(
        [{ role: 'user', content: 'Previous question' }],
        'Search for React tutorials',
        [tool],
        {
          systemTemplate:
            'You are {{role}}. {{customInstructions}} {{toolInstructions}}',
          templateVars: { role: 'a research assistant' },
          extraInstructions: ['Always cite sources.'],
        },
      );

      // System message
      const systemContent = result.messages[0]?.content ?? '';
      expect(systemContent).toContain('a research assistant');
      expect(systemContent).toContain('Always cite sources.');
      expect(systemContent).toContain('search');

      // History preserved
      expect(result.messages[1]?.role).toBe('user');
      expect(result.messages[1]?.content).toBe('Previous question');

      // User input
      const lastMsg = result.messages[result.messages.length - 1];
      expect(lastMsg?.role).toBe('user');
      expect(lastMsg?.content).toBe('Search for React tutorials');

      // Tools converted
      expect(result.tools.length).toBe(1);
      expect(result.tools[0]?.name).toBe('search');

      // Token estimate present
      expect(result.tokenEstimate).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// Static Constants
// ============================================================

describe('DefaultPromptBuilder statics', () => {
  it('has DEFAULT_SYSTEM_TEMPLATE', () => {
    expect(DefaultPromptBuilder.DEFAULT_SYSTEM_TEMPLATE).toBeDefined();
    expect(typeof DefaultPromptBuilder.DEFAULT_SYSTEM_TEMPLATE).toBe('string');
    expect(DefaultPromptBuilder.DEFAULT_SYSTEM_TEMPLATE).toContain(
      'helpful AI assistant',
    );
  });

  it('has TOOL_INSTRUCTIONS_TEMPLATE', () => {
    expect(DefaultPromptBuilder.TOOL_INSTRUCTIONS_TEMPLATE).toBeDefined();
    expect(typeof DefaultPromptBuilder.TOOL_INSTRUCTIONS_TEMPLATE).toBe('string');
    expect(DefaultPromptBuilder.TOOL_INSTRUCTIONS_TEMPLATE).toContain(
      '{{toolList}}',
    );
  });
});

// ============================================================
// Exported Constants
// ============================================================

describe('exported constants', () => {
  it('DEFAULT_SYSTEM_TEMPLATE matches static', () => {
    expect(DEFAULT_SYSTEM_TEMPLATE).toBe(
      DefaultPromptBuilder.DEFAULT_SYSTEM_TEMPLATE,
    );
  });

  it('TOOL_INSTRUCTIONS_TEMPLATE matches static', () => {
    expect(TOOL_INSTRUCTIONS_TEMPLATE).toBe(
      DefaultPromptBuilder.TOOL_INSTRUCTIONS_TEMPLATE,
    );
  });
});
