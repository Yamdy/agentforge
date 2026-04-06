import { describe, test, expect, vi, beforeEach } from 'vitest';
import { MsgHub } from '../../src/workflow/msghub.js';
import type { Agent } from '../../src/agent/index.js';
import type { Message } from '../../src/types.js';

describe('MsgHub', () => {
  test('should create MsgHub with participants', () => {
    const agent1 = { id: 'agent1' } as unknown as Agent;
    const agent2 = { id: 'agent2' } as unknown as Agent;

    const hub = new MsgHub({
      participants: [agent1, agent2],
    });

    expect(hub.participants).toHaveLength(2);
  });

  test('should add and delete participants', () => {
    const agent1 = { id: 'agent1' } as unknown as Agent;
    const agent2 = { id: 'agent2' } as unknown as Agent;
    const agent3 = { id: 'agent3' } as unknown as Agent;

    const hub = new MsgHub({ participants: [agent1] });
    expect(hub.participants).toHaveLength(1);

    hub.add(agent2);
    expect(hub.participants).toHaveLength(2);

    hub.add(agent3);
    expect(hub.participants).toHaveLength(3);

    hub.delete(agent2);
    expect(hub.participants).toHaveLength(2);
  });

  test('should broadcast messages', async () => {
    const agent1 = { id: 'agent1' } as unknown as Agent;
    const hub = new MsgHub({ participants: [agent1] });

    const messages: Message[] = [];
    hub.messages$.subscribe((msg) => messages.push(msg));

    const testMessage: Message = { role: 'user', content: 'Hello' };
    hub.broadcast(testMessage);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(testMessage);
  });
});
