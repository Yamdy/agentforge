import { describe, it, expect } from 'vitest';
import {
  resolveSkillDirectories,
  resolveConfigSources,
  resolveMcpServers,
  type DiscoveryOptions,
} from '../src/discovery.js';

// ---------------------------------------------------------------------------
// Helpers — in-memory SkillFileSystem for MCP tests
// ---------------------------------------------------------------------------

function makeFs(files: Record<string, string>) {
  return {
    readdir: async (dir: string) => {
      const prefix = dir.endsWith('/') ? dir : dir + '/';
      const entries = new Set<string>();
      for (const key of Object.keys(files)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstSegment = rest.split('/')[0];
          if (firstSegment) entries.add(firstSegment);
        }
      }
      if (entries.size === 0) throw new Error(`ENOENT: ${dir}`);
      return [...entries];
    },
    readFile: async (path: string) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
  };
}

// ===========================================================================
// resolveSkillDirectories
// ===========================================================================

describe('resolveSkillDirectories', () => {
  // J1: project + user skill discovery
  it('includes project .agentforge/skills and .agents/skills from cwd', () => {
    const dirs = resolveSkillDirectories('/home/user/project', '/home/user');
    expect(dirs).toContain('/home/user/project/.agentforge/skills');
    expect(dirs).toContain('/home/user/project/.agents/skills');
  });

  it('includes user-level ~/.agentforge/skills and ~/.agents/skills', () => {
    const dirs = resolveSkillDirectories('/home/user/project', '/home/user');
    expect(dirs).toContain('/home/user/.agentforge/skills');
    expect(dirs).toContain('/home/user/.agents/skills');
  });

  // J6: user > project priority
  it('user-level dirs come after project-level dirs (higher priority)', () => {
    const dirs = resolveSkillDirectories('/home/user/project', '/home/user');
    const userForge = dirs.indexOf('/home/user/.agentforge/skills');
    const userAgents = dirs.indexOf('/home/user/.agents/skills');
    const projForge = dirs.indexOf('/home/user/project/.agentforge/skills');
    const projAgents = dirs.indexOf('/home/user/project/.agents/skills');

    expect(userForge).toBeGreaterThan(projForge);
    expect(userAgents).toBeGreaterThan(projAgents);
  });

  // J4: disable .agents convention
  it('excludes .agents dirs when agentsConvention is false', () => {
    const opts: DiscoveryOptions = { agentsConvention: false };
    const dirs = resolveSkillDirectories('/home/user/project', '/home/user', opts);

    expect(dirs).toContain('/home/user/project/.agentforge/skills');
    expect(dirs).toContain('/home/user/.agentforge/skills');
    expect(dirs.some(d => d.includes('.agents/skills'))).toBe(false);
  });

  it('excludes .agentforge dirs when agentforgeConvention is false', () => {
    const opts: DiscoveryOptions = { agentforgeConvention: false };
    const dirs = resolveSkillDirectories('/home/user/project', '/home/user', opts);

    expect(dirs).toContain('/home/user/project/.agents/skills');
    expect(dirs).toContain('/home/user/.agents/skills');
    expect(dirs.some(d => d.includes('.agentforge/skills'))).toBe(false);
  });

  it('excludes both conventions when both are false', () => {
    const opts: DiscoveryOptions = { agentsConvention: false, agentforgeConvention: false };
    const dirs = resolveSkillDirectories('/home/user/project', '/home/user', opts);
    expect(dirs).toEqual([]);
  });

  // extraSkillDirs
  it('includes extraSkillDirs at highest priority', () => {
    const opts: DiscoveryOptions = { extraSkillDirs: ['/custom/skills'] };
    const dirs = resolveSkillDirectories('/home/user/project', '/home/user', opts);

    const customIdx = dirs.indexOf('/custom/skills');
    const userIdx = dirs.lastIndexOf('/home/user/.agents/skills');
    expect(customIdx).toBeGreaterThan(userIdx);
  });
});

// ===========================================================================
// resolveConfigSources
// ===========================================================================

describe('resolveConfigSources', () => {
  // J2: global config auto-resolution
  it('resolves global config from home directory', () => {
    const sources = resolveConfigSources('/home/user/project', '/home/user');
    expect(sources.global).toBe('/home/user/.agentforge/config.jsonc');
  });

  it('resolves project config from cwd', () => {
    const sources = resolveConfigSources('/home/user/project', '/home/user');
    expect(sources.project).toBe('/home/user/project/.agentforge/config.jsonc');
  });

  it('uses cliConfig override instead of default project path', () => {
    const sources = resolveConfigSources('/home/user/project', '/home/user', 'custom.jsonc');
    expect(sources.project).toBe('custom.jsonc');
  });

  // J5: env var
  it('includes env source when AGENTFORGE_CONFIG is set', () => {
    const original = process.env.AGENTFORGE_CONFIG;
    process.env.AGENTFORGE_CONFIG = '{"agents":{}}';
    const sources = resolveConfigSources('/home/user/project', '/home/user');
    expect(sources.env).toBe('{"agents":{}}');
    if (original === undefined) {
      delete process.env.AGENTFORGE_CONFIG;
    } else {
      process.env.AGENTFORGE_CONFIG = original;
    }
  });

  it('omits env source when AGENTFORGE_CONFIG is not set', () => {
    const original = process.env.AGENTFORGE_CONFIG;
    delete process.env.AGENTFORGE_CONFIG;
    const sources = resolveConfigSources('/home/user/project', '/home/user');
    expect(sources.env).toBeUndefined();
    if (original !== undefined) {
      process.env.AGENTFORGE_CONFIG = original;
    }
  });
});

// ===========================================================================
// resolveMcpServers
// ===========================================================================

describe('resolveMcpServers', () => {
  // J3: MCP config file loading
  it('loads MCP servers from project mcp.jsonc', async () => {
    const fs = makeFs({
      '/home/user/project/.agentforge/mcp.jsonc': JSON.stringify({
        mcpServers: {
          'test-server': {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'some-mcp-server'],
          },
        },
      }),
    });

    const servers = await resolveMcpServers('/home/user/project', '/home/user', fs);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('test-server');
    expect(servers[0].transport).toBe('stdio');
  });

  it('loads MCP servers from global mcp.jsonc', async () => {
    const fs = makeFs({
      '/home/user/.agentforge/mcp.jsonc': JSON.stringify({
        mcpServers: {
          'global-server': {
            transport: 'sse',
            url: 'http://localhost:3001/sse',
          },
        },
      }),
    });

    const servers = await resolveMcpServers('/home/user/project', '/home/user', fs);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('global-server');
  });

  // J6: project overrides global
  it('project MCP overrides global MCP for same server name', async () => {
    const fs = makeFs({
      '/home/user/.agentforge/mcp.jsonc': JSON.stringify({
        mcpServers: {
          'shared': { transport: 'sse', url: 'http://global:3001/sse' },
        },
      }),
      '/home/user/project/.agentforge/mcp.jsonc': JSON.stringify({
        mcpServers: {
          'shared': { transport: 'sse', url: 'http://project:3001/sse' },
        },
      }),
    });

    const servers = await resolveMcpServers('/home/user/project', '/home/user', fs);
    expect(servers).toHaveLength(1);
    expect(servers[0].url).toBe('http://project:3001/sse');
  });

  it('returns empty array when no MCP config files exist', async () => {
    const fs = makeFs({});
    const servers = await resolveMcpServers('/home/user/project', '/home/user', fs);
    expect(servers).toEqual([]);
  });

  it('supports JSONC with comments in mcp.jsonc', async () => {
    const fs = makeFs({
      '/home/user/project/.agentforge/mcp.jsonc': `{
  // A comment
  "mcpServers": {
    "commented": {
      "transport": "stdio",
      "command": "echo"
    }
  }
}`,
    });

    const servers = await resolveMcpServers('/home/user/project', '/home/user', fs);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('commented');
  });

  it('merges servers from both global and project config', async () => {
    const fs = makeFs({
      '/home/user/.agentforge/mcp.jsonc': JSON.stringify({
        mcpServers: {
          'global-only': { transport: 'stdio', command: 'global-cmd' },
          'shared': { transport: 'sse', url: 'http://global:3001/sse' },
        },
      }),
      '/home/user/project/.agentforge/mcp.jsonc': JSON.stringify({
        mcpServers: {
          'shared': { transport: 'sse', url: 'http://project:3001/sse' },
          'project-only': { transport: 'stdio', command: 'project-cmd' },
        },
      }),
    });

    const servers = await resolveMcpServers('/home/user/project', '/home/user', fs);
    expect(servers).toHaveLength(3);

    const names = servers.map(s => s.name).sort();
    expect(names).toEqual(['global-only', 'project-only', 'shared']);

    const shared = servers.find(s => s.name === 'shared');
    expect(shared?.url).toBe('http://project:3001/sse');
  });
});
