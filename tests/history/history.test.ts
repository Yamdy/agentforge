import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryHistory } from '../../src/history';

describe('InMemoryHistory', () => {
  let history: InMemoryHistory;

  beforeEach(() => {
    history = new InMemoryHistory();
  });

  it('should add messages and retrieve them', () => {
    history.add('user', 'Hello');
    history.add('assistant', 'Hi there');

    const messages = history.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi there' });
  });

  it('should clear history', () => {
    history.add('user', 'Hello');
    history.clear();

    expect(history.getMessages()).toHaveLength(0);
  });

  it('should use role tool for tool results', () => {
    history.addToolResult('call_1', 'readFile', 'file content');

    const messages = history.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('tool');
  });

  it('should return messages in insertion order with interleaved tool results', () => {
    history.add('user', 'Read the file');
    history.add('assistant', 'I will read the file');
    history.addToolResult('call_1', 'readFile', 'file content');
    history.add('assistant', 'The file contains...');

    const messages = history.getMessages();
    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: 'user', content: 'Read the file' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'I will read the file' });
    expect(messages[2].role).toBe('tool');
    expect(messages[3]).toEqual({ role: 'assistant', content: 'The file contains...' });
  });

  it('should include toolCallId and toolName in tool result messages', () => {
    history.addToolResult('call_123', 'readFile', 'file content here');

    const messages = history.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: 'tool',
      content: 'file content here',
      toolCallId: 'call_123',
      toolName: 'readFile',
    });
  });
});
