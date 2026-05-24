import { describe, it, expect } from 'vitest';
import { isolatedMessageFilter } from '../../src/subagent/delegation';

describe('isolated subagent', () => {
  describe('isolatedMessageFilter', () => {
    it('should return only the prompt as a single user message', () => {
      const result = isolatedMessageFilter({
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'What is the meaning of life?' },
          { role: 'assistant', content: 'I think it is 42' },
        ],
        subAgentName: 'test-agent',
        prompt: 'Calculate 2 + 2',
      });

      expect(result).toEqual([{ role: 'user', content: 'Calculate 2 + 2' }]);
    });
  });
});
