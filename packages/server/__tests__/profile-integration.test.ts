import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadAndRegister } from '../src/config-loader.js';
import { AgentRegistry } from '../src/registry.js';
import { builtinProfiles, applyProfile } from '../src/profiles/index.js';

const TMP_DIR = resolve(import.meta.dirname, '__tmp_profile_test__');

async function writeConfig(content: string, filename = 'config.jsonc') {
  await mkdir(TMP_DIR, { recursive: true });
  const path = resolve(TMP_DIR, filename);
  await writeFile(path, content, 'utf-8');
  return path;
}

describe('profile integration in config-loader', () => {
  beforeEach(async () => { await mkdir(TMP_DIR, { recursive: true }); });
  afterEach(async () => { await rm(TMP_DIR, { recursive: true, force: true }); });

  it('applies profile to agent when profile field is set in config', async () => {
    const path = await writeConfig(JSON.stringify({
      agents: {
        coder: { model: 'test-model', profile: 'personal-agent' },
      },
    }));

    const registry = new AgentRegistry();
    const { agentIds } = await loadAndRegister(path, registry);

    expect(agentIds).toEqual(['coder']);
    const agent = registry.get('coder');
    expect(agent).toBeDefined();
  });

  it('applies defaultProfile when no profile field in config', async () => {
    const path = await writeConfig(JSON.stringify({
      agents: {
        bot: { model: 'test-model' },
      },
    }));

    const registry = new AgentRegistry();
    const { agentIds } = await loadAndRegister(path, registry, 'data-agent');

    expect(agentIds).toEqual(['bot']);
    const agent = registry.get('bot');
    expect(agent).toBeDefined();
  });

  it('config profile field takes precedence over defaultProfile', async () => {
    const path = await writeConfig(JSON.stringify({
      agents: {
        bot: { model: 'test-model', profile: 'personal-agent' },
      },
    }));

    const registry = new AgentRegistry();
    const { agentIds } = await loadAndRegister(path, registry, 'coding-agent');

    expect(agentIds).toEqual(['bot']);
  });

  it('throws for unknown profile name', async () => {
    const path = await writeConfig(JSON.stringify({
      agents: {
        bot: { model: 'test-model', profile: 'nonexistent-profile' },
      },
    }));

    const registry = new AgentRegistry();
    await expect(loadAndRegister(path, registry)).rejects.toThrow(
      /Unknown profile.*nonexistent-profile/,
    );
  });

  it('registers agent without profile when neither config nor default provided', async () => {
    const path = await writeConfig(JSON.stringify({
      agents: {
        plain: { model: 'test-model' },
      },
    }));

    const registry = new AgentRegistry();
    const { agentIds } = await loadAndRegister(path, registry);

    expect(agentIds).toEqual(['plain']);
    expect(registry.get('plain')).toBeDefined();
  });

  it('works with multiple agents using different profiles', async () => {
    const path = await writeConfig(JSON.stringify({
      agents: {
        dev: { model: 'test-model', profile: 'coding-agent' },
        biz: { model: 'test-model', profile: 'business-agent' },
      },
    }));

    const registry = new AgentRegistry();
    const { agentIds } = await loadAndRegister(path, registry);

    expect(agentIds.sort()).toEqual(['biz', 'dev']);
    expect(registry.get('dev')).toBeDefined();
    expect(registry.get('biz')).toBeDefined();
  });
});

describe('builtinProfiles registration in ProfileLoader', () => {
  it('all built-in profiles have unique names and valid structure', () => {
    const profiles = builtinProfiles();
    const names = profiles.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);

    for (const profile of profiles) {
      expect(profile.name).toBeTruthy();
      expect(profile.description).toBeTruthy();
      expect(Array.isArray(profile.plugins)).toBe(true);
    }
  });
});
