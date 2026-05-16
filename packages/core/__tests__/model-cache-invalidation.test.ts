import { describe, it, expect } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel } from './helpers.js';
import type { LanguageModel } from 'ai';

/**
 * A-5 fix: _model cache auto-invalidation on auth/not-found errors.
 *
 * User journey:
 *   As an Agent developer, I want the model cache to auto-invalidate when
 *   LLM calls fail with authentication (401/403) or model-not-found (404)
 *   errors, so that credential rotation and model changes are handled
 *   automatically without calling invalidateModel() manually.
 */

function createAuthErrorModel(statusCode: number, message: string): LanguageModel {
  return {
    modelId: 'auth-error-model',
    specificationVersion: 'v3',
    provider: 'mock',
    supportedUrls: {},
    async doGenerate() {
      const err = new Error(message) as Error & { statusCode?: number };
      err.statusCode = statusCode;
      throw err;
    },
    async doStream() {
      const err = new Error(message) as Error & { statusCode?: number };
      err.statusCode = statusCode;
      throw err;
    },
  } as unknown as LanguageModel;
}

function createStatusErrorModel(status: number, message: string): LanguageModel {
  return {
    modelId: 'status-error-model',
    specificationVersion: 'v3',
    provider: 'mock',
    supportedUrls: {},
    async doGenerate() {
      const err = new Error(message) as Error & { status?: number };
      err.status = status;
      throw err;
    },
    async doStream() {
      const err = new Error(message) as Error & { status?: number };
      err.status = status;
      throw err;
    },
  } as unknown as LanguageModel;
}

describe('A-5: Model cache auto-invalidation', () => {
  it('auto-invalidates cached model on 401 authentication error', async () => {
    let resolveCount = 0;
    const authErrorModel = createAuthErrorModel(401, 'Invalid API key');
    const goodModel = createMockLanguageModel({ text: 'recovered' });

    const { ModelFactory } = await import('../src/model-factory.js');
    const factory = new ModelFactory();

    factory.registerGateway({
      name: 'test',
      canResolve: () => true,
      resolve: async () => {
        resolveCount++;
        return resolveCount === 1 ? authErrorModel : goodModel;
      },
    });

    const agent = new Agent({ model: 'test/model' }, { modelFactory: factory });

    await expect(agent.run('test')).rejects.toThrow('Invalid API key');
    expect(resolveCount).toBe(1);

    const result = await agent.run('test');
    expect(result.response).toBe('recovered');
    expect(resolveCount).toBe(2);
  });

  it('auto-invalidates cached model on 404 model-not-found error', async () => {
    let resolveCount = 0;
    const notFoundModel = createAuthErrorModel(404, 'Model not found');
    const goodModel = createMockLanguageModel({ text: 'recovered' });

    const { ModelFactory } = await import('../src/model-factory.js');
    const factory = new ModelFactory();
    factory.registerGateway({
      name: 'test',
      canResolve: () => true,
      resolve: async () => {
        resolveCount++;
        return resolveCount === 1 ? notFoundModel : goodModel;
      },
    });

    const agent = new Agent({ model: 'test/model' }, { modelFactory: factory });

    await expect(agent.run('test')).rejects.toThrow('Model not found');
    expect(resolveCount).toBe(1);

    const result = await agent.run('test');
    expect(result.response).toBe('recovered');
    expect(resolveCount).toBe(2);
  });

  it('auto-invalidates cached model on 403 forbidden error', async () => {
    let resolveCount = 0;
    const forbiddenModel = createAuthErrorModel(403, 'Forbidden');
    const goodModel = createMockLanguageModel({ text: 'recovered' });

    const { ModelFactory } = await import('../src/model-factory.js');
    const factory = new ModelFactory();
    factory.registerGateway({
      name: 'test',
      canResolve: () => true,
      resolve: async () => {
        resolveCount++;
        return resolveCount === 1 ? forbiddenModel : goodModel;
      },
    });

    const agent = new Agent({ model: 'test/model' }, { modelFactory: factory });

    await expect(agent.run('test')).rejects.toThrow('Forbidden');
    expect(resolveCount).toBe(1);

    const result = await agent.run('test');
    expect(result.response).toBe('recovered');
    expect(resolveCount).toBe(2);
  });

  it('does NOT invalidate cached model on 500 server error', async () => {
    let resolveCount = 0;
    const serverErrorModel = createAuthErrorModel(500, 'Internal server error');

    const { ModelFactory } = await import('../src/model-factory.js');
    const factory = new ModelFactory();
    factory.registerGateway({
      name: 'test',
      canResolve: () => true,
      resolve: async () => {
        resolveCount++;
        return serverErrorModel;
      },
    });

    const agent = new Agent({ model: 'test/model' }, { modelFactory: factory });

    await expect(agent.run('test')).rejects.toThrow('Internal server error');
    expect(resolveCount).toBe(1);

    await expect(agent.run('test')).rejects.toThrow('Internal server error');
    expect(resolveCount).toBe(1);
  });

  it('does NOT invalidate cached model on generic errors without statusCode', async () => {
    let resolveCount = 0;
    const genericErrorModel: LanguageModel = {
      modelId: 'generic-error',
      specificationVersion: 'v3',
      provider: 'mock',
      supportedUrls: {},
      async doGenerate() { throw new Error('something went wrong'); },
      async doStream() { throw new Error('something went wrong'); },
    } as unknown as LanguageModel;

    const { ModelFactory } = await import('../src/model-factory.js');
    const factory = new ModelFactory();
    factory.registerGateway({
      name: 'test',
      canResolve: () => true,
      resolve: async () => {
        resolveCount++;
        return genericErrorModel;
      },
    });

    const agent = new Agent({ model: 'test/model' }, { modelFactory: factory });

    await expect(agent.run('test')).rejects.toThrow('something went wrong');
    expect(resolveCount).toBe(1);

    await expect(agent.run('test')).rejects.toThrow('something went wrong');
    expect(resolveCount).toBe(1);
  });

  it('auto-invalidates on error with status property (AI SDK APICallError shape)', async () => {
    let resolveCount = 0;
    const apiCallErrorModel = createStatusErrorModel(401, 'Unauthorized');
    const goodModel = createMockLanguageModel({ text: 'recovered' });

    const { ModelFactory } = await import('../src/model-factory.js');
    const factory = new ModelFactory();
    factory.registerGateway({
      name: 'test',
      canResolve: () => true,
      resolve: async () => {
        resolveCount++;
        return resolveCount === 1 ? apiCallErrorModel : goodModel;
      },
    });

    const agent = new Agent({ model: 'test/model' }, { modelFactory: factory });

    await expect(agent.run('test')).rejects.toThrow('Unauthorized');
    expect(resolveCount).toBe(1);

    const result = await agent.run('test');
    expect(result.response).toBe('recovered');
    expect(resolveCount).toBe(2);
  });
});
