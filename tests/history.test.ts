import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryHistory } from '../src/history';

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
});
