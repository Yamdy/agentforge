import { describe, test, expect, vi, beforeEach } from 'vitest';
import { MsgHub } from '../../src/workflow/msghub.js';
import type { Agent } from '../../src/agent/index.js';
import type { Message } from '../../src/types.js';
import { Subject } from 'rxjs';

function createMockAgent(id: string): Agent {
  const responseSubject = new Subject<Message>();
  return {
    id,
    observe: vi.fn(),
    onResponse: () => responseSubject.asObservable(),
    _responseSubject: responseSubject,
  } as unknown as Agent;
}

describe('MsgHub', () => {
  test('should create MsgHub with participants', () => {
    const agent1 = createMockAgent('agent1');
    const agent2 = createMockAgent('agent2');

    const hub = new MsgHub({
      participants: [agent1, agent2],
    });

    expect(hub.participants).toHaveLength(2);
  });

  test('should add and delete participants', () => {
    const agent1 = createMockAgent('agent1');
    const agent2 = createMockAgent('agent2');
    const agent3 = createMockAgent('agent3');

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
    const agent1 = createMockAgent('agent1');
    const hub = new MsgHub({ participants: [agent1] });

    const messages: Message[] = [];
    hub.messages$.subscribe((msg) => messages.push(msg));

    const testMessage: Message = { role: 'user', content: 'Hello' };
    hub.broadcast(testMessage);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(testMessage);
  });

  test('should auto-broadcast agent responses to other participants', async () => {
    const agent1 = createMockAgent('agent1');
    const agent2 = createMockAgent('agent2');

    const hub = new MsgHub({
      participants: [agent1, agent2],
      enableAutoBroadcast: true,
    });

    const receivedMessages: Message[] = [];
    hub.messages$.subscribe((msg) => receivedMessages.push(msg));

    const responseMessage: Message = { role: 'assistant', content: 'Hello from agent1' };
    (agent1 as unknown as { _responseSubject: Subject<Message> })._responseSubject.next(responseMessage);

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]).toEqual(responseMessage);
    expect(agent2.observe).toHaveBeenCalledWith(responseMessage);
    expect(agent1.observe).not.toHaveBeenCalled();
  });

  test('should not auto-broadcast when enableAutoBroadcast is false', async () => {
    const agent1 = createMockAgent('agent1');
    const agent2 = createMockAgent('agent2');

    const hub = new MsgHub({
      participants: [agent1, agent2],
      enableAutoBroadcast: false,
    });

    const responseMessage: Message = { role: 'assistant', content: 'Hello from agent1' };
    (agent1 as unknown as { _responseSubject: Subject<Message> })._responseSubject.next(responseMessage);

    expect(agent2.observe).not.toHaveBeenCalled();
  });

  test('should clean up subscriptions on dispose', async () => {
    const agent1 = createMockAgent('agent1');
    const agent2 = createMockAgent('agent2');

    const hub = new MsgHub({
      participants: [agent1, agent2],
      enableAutoBroadcast: true,
    });

    await hub[Symbol.asyncDispose]();

    const responseMessage: Message = { role: 'assistant', content: 'Hello' };
    (agent1 as unknown as { _responseSubject: Subject<Message> })._responseSubject.next(responseMessage);

    expect(agent2.observe).not.toHaveBeenCalled();
  });

  test('should support name property', () => {
    const agent1 = createMockAgent('agent1');
    const hub = new MsgHub({
      participants: [agent1],
      name: 'test-hub',
    });

    expect(hub.name).toBe('test-hub');
  });
});
