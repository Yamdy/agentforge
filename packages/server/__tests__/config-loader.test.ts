import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/config-loader.js';

describe('validateConfig', () => {
  it('passes a valid config with agents and modelGateways', () => {
    const config = {
      agents: {
        assistant: { model: 'gpt-4', prompt: 'You are helpful' },
      },
      modelGateways: [
        { name: 'openai', url: 'https://api.openai.com/v1', apiKey: 'sk-test' },
      ],
    };
    const result = validateConfig(config);
    expect(result).toEqual(config);
  });

  it('passes a minimal valid config (empty object)', () => {
    const result = validateConfig({});
    expect(result).toEqual({});
  });

  it('passes a config with only agents', () => {
    const config = {
      agents: { bot: { model: 'claude-3' } },
    };
    const result = validateConfig(config);
    expect(result).toEqual(config);
  });

  it('throws when an agent entry is missing model', () => {
    expect(() =>
      validateConfig({ agents: { bot: { prompt: 'hi' } } }),
    ).toThrow(/agent "bot".*model/);
  });

  it('throws when agents is not an object', () => {
    expect(() => validateConfig({ agents: 'not-an-object' })).toThrow(
      /agents.*object/,
    );
  });

  it('throws when a modelGateway entry is missing name', () => {
    expect(() =>
      validateConfig({
        modelGateways: [{ url: 'https://example.com' }],
      }),
    ).toThrow(/gateway.*0.*name/);
  });

  it('throws when a modelGateway entry is missing url', () => {
    expect(() =>
      validateConfig({
        modelGateways: [{ name: 'mygateway' }],
      }),
    ).toThrow(/gateway.*0.*url/);
  });

  it('collects multiple errors into a single throw', () => {
    expect(() =>
      validateConfig({
        agents: {
          bot1: { prompt: 'hi' },
          bot2: { prompt: 'yo' },
        },
        modelGateways: [{ name: 'x' }],
      }),
    ).toThrow(/agent "bot1".*model.*agent "bot2".*model.*gateway.*0.*url/s);
  });

  it('throws when modelGateways is not an array', () => {
    expect(() => validateConfig({ modelGateways: 'bad' })).toThrow(
      /modelGateways.*array/,
    );
  });

  it('throws when agents is an array', () => {
    expect(() => validateConfig({ agents: [] })).toThrow(/agents.*object/);
  });

  it('allows agent model as a non-empty string', () => {
    const config = { agents: { bot: { model: 'gpt-4o' } } };
    const result = validateConfig(config);
    expect(result.agents!.bot.model).toBe('gpt-4o');
  });

  it('throws when agent model is an empty string', () => {
    expect(() =>
      validateConfig({ agents: { bot: { model: '' } } }),
    ).toThrow(/agent "bot".*model/);
  });

  it('throws when agent model is not a string', () => {
    expect(() =>
      validateConfig({ agents: { bot: { model: 123 } } }),
    ).toThrow(/agent "bot".*model/);
  });
});
