import { resolve, join, extname, basename } from 'node:path';
import { readFile, writeFile, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { L1AgentConfigSchema } from '@primo512109/agentforge';
import type { L1AgentConfig } from '@primo512109/agentforge';

/**
 * Config store interface for agent configuration persistence.
 */
export interface ConfigStore {
  listAgentConfigs(): Promise<L1AgentConfig[]>;
  getAgentConfig(id: string): Promise<L1AgentConfig | null>;
  saveAgentConfig(id: string, config: unknown): Promise<void>;
  deleteAgentConfig(id: string): Promise<boolean>;
}

/**
 * File-based config store that reads/writes L1 agent configs from a directory.
 *
 * Uses async I/O via fs/promises and atomic writes (temp file + rename)
 * to prevent data corruption on crash.
 */
export class FileConfigStore implements ConfigStore {
  private readonly configDir: string;
  private readonly initPromise: Promise<void>;

  constructor(configDir: string) {
    this.configDir = resolve(configDir);
    // Auto-create config directory on first access
    this.initPromise = mkdir(this.configDir, { recursive: true }).then(() => {
      /* void */
    });
  }

  private async ensureInit(): Promise<void> {
    await this.initPromise;
  }

  async listAgentConfigs(): Promise<L1AgentConfig[]> {
    await this.ensureInit();
    const configs: L1AgentConfig[] = [];

    let entries: string[];
    try {
      entries = await readdir(this.configDir);
    } catch {
      // Directory doesn't exist yet or is unreadable
      return configs;
    }

    for (const entry of entries) {
      const ext = extname(entry);
      if (ext !== '.json' && ext !== '.jsonc') continue;

      const id = basename(entry, ext);
      const config = await this.getAgentConfig(id);
      if (config) {
        configs.push(config);
      }
    }

    return configs;
  }

  async getAgentConfig(id: string): Promise<L1AgentConfig | null> {
    await this.ensureInit();

    // Try .json first, then .jsonc
    const candidates = [
      join(this.configDir, `${id}.json`),
      join(this.configDir, `${id}.jsonc`),
    ];

    for (const filePath of candidates) {
      try {
        const raw = await readFile(filePath, 'utf-8');
        let content = raw;

        // Strip JSONC comments (simple single-line comment removal)
        if (filePath.endsWith('.jsonc')) {
          content = content.replace(/\/\/.*$/gm, '');
          content = content.replace(/\/\*[\s\S]*?\*\//g, '');
        }

        const parsed = JSON.parse(content) as unknown;
        const result = L1AgentConfigSchema.safeParse(parsed);
        if (result.success) {
          return result.data;
        }
        // If validation fails, skip this file
      } catch {
        // File not found or parse error — try next candidate
      }
    }

    return null;
  }

  async saveAgentConfig(id: string, config: unknown): Promise<void> {
    await this.ensureInit();

    // Validate config with Zod
    const result = L1AgentConfigSchema.safeParse(config);
    if (!result.success) {
      const errors = result.error.issues
        .map((issue: { path: (string | number)[]; message: string }) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid agent config: ${errors}`);
    }

    // Atomic write: write to temp file, then rename
    const targetPath = join(this.configDir, `${id}.json`);
    const tmpPath = join(this.configDir, `${id}.json.tmp`);
    await writeFile(tmpPath, JSON.stringify(result.data, null, 2), 'utf-8');
    await rename(tmpPath, targetPath);
  }

  async deleteAgentConfig(id: string): Promise<boolean> {
    await this.ensureInit();

    const candidates = [
      join(this.configDir, `${id}.json`),
      join(this.configDir, `${id}.jsonc`),
    ];

    for (const filePath of candidates) {
      try {
        await unlink(filePath);
        return true;
      } catch {
        // File not found — try next candidate
      }
    }

    return false;
  }
}