import { describe, it, expect } from 'vitest';
import {
  type ContentBlock,
  type TextBlock,
  type ThinkingBlock,
  type ToolCallBlock,
  type ToolResultBlock,
  type IterationRegion,
} from '@primo-ai/sdk';

describe('ContentBlock types', () => {
  it('TextBlock has type=text and text', () => {
    const block: TextBlock = { type: 'text', text: 'hello' };
    expect(block.type).toBe('text');
    expect(block.text).toBe('hello');
  });

  it('ThinkingBlock has type=thinking and text', () => {
    const block: ThinkingBlock = { type: 'thinking', text: 'let me think...' };
    expect(block.type).toBe('thinking');
    expect(block.text).toBe('let me think...');
  });

  it('ToolCallBlock has type=tool-call with id, name, args', () => {
    const block: ToolCallBlock = { type: 'tool-call', id: 'tc1', name: 'read', args: { path: '/foo' } };
    expect(block.type).toBe('tool-call');
    expect(block.id).toBe('tc1');
    expect(block.name).toBe('read');
  });

  it('ToolResultBlock has type=tool-result with toolCallId, name, output', () => {
    const block: ToolResultBlock = { type: 'tool-result', toolCallId: 'tc1', name: 'read', output: 'file contents' };
    expect(block.type).toBe('tool-result');
    expect(block.output).toBe('file contents');
  });

  it('ToolResultBlock can have error', () => {
    const block: ToolResultBlock = { type: 'tool-result', toolCallId: 'tc1', name: 'read', output: null, error: 'file not found' };
    expect(block.error).toBe('file not found');
  });
});

describe('content-blocks helpers', () => {
  it('assembleContentBlocks combines text, tool calls, and reasoning', async () => {
    const { assembleContentBlocks } = await import('../src/content-blocks.js');
    const blocks = assembleContentBlocks(
      ['hello '],
      [{ id: 'tc1', name: 'read', args: { path: '/a' } }],
      ['thinking...'],
    );

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'thinking', text: 'thinking...' });
    expect(blocks[1]).toEqual({ type: 'text', text: 'hello ' });
    expect(blocks[2]).toEqual({ type: 'tool-call', id: 'tc1', name: 'read', args: { path: '/a' } });
  });

  it('assembleContentBlocks works with empty arrays', async () => {
    const { assembleContentBlocks } = await import('../src/content-blocks.js');
    const blocks = assembleContentBlocks([], [], []);
    expect(blocks).toEqual([]);
  });

  it('assembleContentBlocks with only text merges parts into single block', async () => {
    const { assembleContentBlocks } = await import('../src/content-blocks.js');
    const blocks = assembleContentBlocks(['hello', ' world'], [], []);
    expect(blocks).toEqual([
      { type: 'text', text: 'hello world' },
    ]);
  });

  it('textContentFromBlocks concatenates text from TextBlock entries', async () => {
    const { textContentFromBlocks } = await import('../src/content-blocks.js');
    const blocks: ContentBlock[] = [
      { type: 'thinking', text: 'hmm' },
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
      { type: 'tool-call', id: 'tc1', name: 'read', args: {} },
    ];
    expect(textContentFromBlocks(blocks)).toBe('hello world');
  });

  it('textContentFromBlocks returns empty string for empty array', async () => {
    const { textContentFromBlocks } = await import('../src/content-blocks.js');
    expect(textContentFromBlocks([])).toBe('');
  });

  it('textContentFromBlocks returns empty string when no TextBlocks', async () => {
    const { textContentFromBlocks } = await import('../src/content-blocks.js');
    const blocks: ContentBlock[] = [
      { type: 'thinking', text: 'hmm' },
      { type: 'tool-call', id: 'tc1', name: 'read', args: {} },
    ];
    expect(textContentFromBlocks(blocks)).toBe('');
  });

  it('toolCallsFromBlocks extracts ToolCallBlock entries as ToolCall[]', async () => {
    const { toolCallsFromBlocks } = await import('../src/content-blocks.js');
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hi' },
      { type: 'tool-call', id: 'tc1', name: 'read', args: { path: '/a' } },
      { type: 'tool-call', id: 'tc2', name: 'write', args: { path: '/b' } },
    ];
    const calls = toolCallsFromBlocks(blocks);
    expect(calls).toEqual([
      { id: 'tc1', name: 'read', args: { path: '/a' } },
      { id: 'tc2', name: 'write', args: { path: '/b' } },
    ]);
  });

  it('toolCallsFromBlocks returns empty array when no ToolCallBlocks', async () => {
    const { toolCallsFromBlocks } = await import('../src/content-blocks.js');
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hi' }];
    expect(toolCallsFromBlocks(blocks)).toEqual([]);
  });

  it('reasoningFromBlocks concatenates ThinkingBlock text', async () => {
    const { reasoningFromBlocks } = await import('../src/content-blocks.js');
    const blocks: ContentBlock[] = [
      { type: 'thinking', text: 'step 1: ' },
      { type: 'text', text: 'result' },
      { type: 'thinking', text: 'step 2' },
    ];
    expect(reasoningFromBlocks(blocks)).toBe('step 1: step 2');
  });

  it('reasoningFromBlocks returns undefined when no ThinkingBlocks', async () => {
    const { reasoningFromBlocks } = await import('../src/content-blocks.js');
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hi' }];
    expect(reasoningFromBlocks(blocks)).toBeUndefined();
  });
});

describe('IterationRegion.content', () => {
  it('IterationRegion accepts content field', () => {
    const iter: IterationRegion = {
      step: 1,
      content: [
        { type: 'thinking', text: 'hmm' },
        { type: 'text', text: 'hello' },
        { type: 'tool-call', id: 'tc1', name: 'read', args: {} },
      ],
    };
    expect(iter.content).toHaveLength(3);
  });

  it('IterationRegion backward compat: response still works', () => {
    const iter: IterationRegion = {
      step: 1,
      response: 'hello world',
    };
    expect(iter.response).toBe('hello world');
  });

  it('IterationRegion can have both content and response', () => {
    const iter: IterationRegion = {
      step: 1,
      content: [{ type: 'text', text: 'hello' }],
      response: 'hello',
    };
    expect(iter.content).toHaveLength(1);
    expect(iter.response).toBe('hello');
  });
});
