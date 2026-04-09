import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { McpServerConfigSchema, type McpServerConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_FILE_NAME = 'mcp.config.json';

export class McpConfig {
  private config: Record<string, McpServerConfig> = {};
  private configPath?: string;

  async load(): Promise<void> {
    const paths = [
      path.join(process.cwd(), CONFIG_FILE_NAME),
      path.join(process.env.HOME || '', '.agentforge', CONFIG_FILE_NAME),
    ];

    for (const p of paths) {
      try {
        const content = await fs.readFile(p, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.servers) {
          this.config = this.validateConfig(parsed.servers);
          this.configPath = p;
          break;
        }
      } catch {
        continue;
      }
    }

    this.loadFromEnv();
  }

  private validateConfig(servers: Record<string, unknown>): Record<string, McpServerConfig> {
    const result: Record<string, McpServerConfig> = {};
    for (const [name, config] of Object.entries(servers)) {
      try {
        result[name] = McpServerConfigSchema.parse(config);
      } catch (e) {
        console.warn(`Invalid config for server ${name}:`, e);
      }
    }
    return result;
  }

  private loadFromEnv(): void {
    if (process.env.MCP_SERVERS) {
      try {
        const servers = JSON.parse(process.env.MCP_SERVERS);
        Object.assign(this.config, this.validateConfig(servers));
      } catch (e) {
        console.warn('Failed to parse MCP_SERVERS env var:', e);
      }
    }
  }

  getServers(): Record<string, McpServerConfig> {
    return { ...this.config };
  }

  getServer(name: string): McpServerConfig | undefined {
    return this.config[name];
  }

  async setServer(name: string, config: McpServerConfig): Promise<void> {
    this.config[name] = McpServerConfigSchema.parse(config);
    await this.save();
  }

  async removeServer(name: string): Promise<void> {
    delete this.config[name];
    await this.save();
  }

  private async save(): Promise<void> {
    if (!this.configPath) {
      this.configPath = path.join(process.cwd(), CONFIG_FILE_NAME);
    }
    const content = JSON.stringify({ version: '1', servers: this.config }, null, 2);
    await fs.writeFile(this.configPath, content, 'utf-8');
  }
}

export const config = new McpConfig();
