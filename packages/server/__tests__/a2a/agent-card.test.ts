import { describe, it, expect } from 'vitest';
import { buildAgentCard, type AgentCardOptions } from '../../src/a2a/agent-card.js';
import type { A2AAgentCard } from '../../src/a2a/types.js';

describe('buildAgentCard', () => {
  const minimalOptions: AgentCardOptions = {
    name: 'Test Agent',
    description: 'A test agent',
    url: 'http://localhost:3000/a2a',
    version: '1.0.0',
  };

  it('builds a minimal valid AgentCard', () => {
    const card = buildAgentCard(minimalOptions);

    expect(card.name).toBe('Test Agent');
    expect(card.description).toBe('A test agent');
    expect(card.url).toBe('http://localhost:3000/a2a');
    expect(card.version).toBe('1.0.0');
    expect(card.defaultInputModes).toContain('text/plain');
    expect(card.defaultOutputModes).toContain('text/plain');
    expect(card.capabilities.streaming).toBe(true);
    expect(card.skills).toEqual([]);
  });

  it('includes skills from options', () => {
    const card = buildAgentCard({
      ...minimalOptions,
      skills: [
        { id: 'echo', name: 'Echo', description: 'Echoes input', tags: ['utility'] },
      ],
    });

    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('echo');
    expect(card.skills[0].tags).toContain('utility');
  });

  it('includes provider info', () => {
    const card = buildAgentCard({
      ...minimalOptions,
      provider: { url: 'https://example.com', organization: 'Acme' },
    });

    expect(card.provider).toEqual({ url: 'https://example.com', organization: 'Acme' });
  });

  it('sets streaming capability from options', () => {
    const card = buildAgentCard({
      ...minimalOptions,
      streaming: false,
    });

    expect(card.capabilities.streaming).toBe(false);
  });

  it('derives skills from AgentConfig tools', () => {
    const card = buildAgentCard({
      ...minimalOptions,
      tools: [
        { name: 'web_search', description: 'Search the web' },
        { name: 'calculator', description: 'Do math' },
      ],
    });

    expect(card.skills).toHaveLength(2);
    expect(card.skills[0].id).toBe('web_search');
    expect(card.skills[0].name).toBe('web_search');
    expect(card.skills[0].description).toBe('Search the web');
    expect(card.skills[0].tags).toEqual(['tool']);
  });

  it('includes documentationUrl', () => {
    const card = buildAgentCard({
      ...minimalOptions,
      documentationUrl: 'https://docs.example.com/agent',
    });

    expect(card.documentationUrl).toBe('https://docs.example.com/agent');
  });

  it('serializes to valid JSON', () => {
    const card = buildAgentCard(minimalOptions);
    const json = JSON.stringify(card);
    const parsed = JSON.parse(json) as A2AAgentCard;

    expect(parsed.name).toBe(card.name);
    expect(parsed.skills).toEqual(card.skills);
  });

  it('merges explicit skills with tool-derived skills', () => {
    const card = buildAgentCard({
      ...minimalOptions,
      skills: [
        { id: 'custom', name: 'Custom', description: 'Custom skill', tags: ['custom'] },
      ],
      tools: [
        { name: 'tool-a', description: 'Tool A' },
      ],
    });

    expect(card.skills).toHaveLength(2);
    expect(card.skills.map((s) => s.id)).toContain('custom');
    expect(card.skills.map((s) => s.id)).toContain('tool-a');
  });
});
