import type { LLMAdapter, LLMRequest, LLMResponse } from '../src/types.js';

/**
 * Mock LLM adapter for testing.
 * Pre-program responses and verify requests made during a test.
 */
export class MockLLMAdapter implements LLMAdapter {
  maxContextWindow = 128000;
  readonly requests: LLMRequest[] = [];
  private responseQueue: LLMResponse[];

  constructor(responses: LLMResponse[]) {
    this.responseQueue = [...responses];
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request);
    const response = this.responseQueue.shift();
    if (!response) {
      throw new Error('MockLLMAdapter: no more responses available');
    }
    return response;
  }
}
