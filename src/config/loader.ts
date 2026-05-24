import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { z } from 'zod';
// import { AgentForgeConfigSchema } from './schema.js';
import { validateAgentForgeConfig } from './index.js';
import type { AgentForgeConfig } from './schema.js';
import { AppError, ValidationError } from '../errors/index.js';

export interface LoadConfigOptions {
  filePath?: string;
  searchPaths?: string[];
  validate?: boolean;
}

export class ConfigLoader {
  private searchPaths: string[];

  constructor(searchPaths: string[] = []) {
    this.searchPaths = [
      process.cwd(),
      path.join(process.cwd(), 'agentforge'),
      path.join(process.cwd(), '.agentforge'),
      ...searchPaths,
    ];
  }

  /**
   * Find config file by searching in multiple paths
   */
  findConfigFile(): string | null {
    const extensions = ['.md', '.markdown', '.json', '.agentforge.json'];
    const baseNames = ['agentforge.config', 'agent', 'agentforge'];

    for (const searchPath of this.searchPaths) {
      for (const baseName of baseNames) {
        for (const ext of extensions) {
          const fullPath = path.join(searchPath, `${baseName}${ext}`);
          if (fs.existsSync(fullPath)) {
            return fullPath;
          }
        }
      }
    }

    return null;
  }

  /**
   * Load configuration from file
   */
  async loadConfig(options: LoadConfigOptions = {}): Promise<AgentForgeConfig> {
    let filePath = options.filePath;

    if (!filePath) {
      const foundPath = this.findConfigFile();
      if (!foundPath) {
        throw new AppError('No configuration file found in search paths', 'CONFIG_NOT_FOUND');
      }
      filePath = foundPath;
    }

    if (!fs.existsSync(filePath)) {
      throw new AppError(`Configuration file not found: ${filePath}`, 'CONFIG_NOT_FOUND');
    }

    const ext = path.extname(filePath).toLowerCase();

    let configData: Record<string, unknown>;

    if (ext === '.md' || ext === '.markdown') {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = matter(content);
      configData = {
        ...(parsed.data as Record<string, unknown>),
        ...(parsed.content.trim() && {
          agent: {
            ...((parsed.data as Record<string, unknown>).agent as Record<string, unknown>),
            systemPrompt: parsed.content.trim(),
          },
        }),
      };
    } else if (ext === '.json') {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      configData = JSON.parse(content) as Record<string, unknown>;
    } else {
      throw new AppError(`Unsupported config file format: ${ext}`, 'INVALID_CONFIG_FORMAT');
    }

    if (options.validate ?? true) {
      try {
        return validateAgentForgeConfig(configData);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issues = error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(', ');
          throw new ValidationError(`Configuration validation failed: ${issues}`);
        }
        throw error;
      }
    }

    return configData as AgentForgeConfig;
  }

  /**
   * Load configuration synchronously
   */
  loadConfigSync(options: LoadConfigOptions = {}): AgentForgeConfig {
    let filePath = options.filePath;

    if (!filePath) {
      const foundPath = this.findConfigFile();
      if (!foundPath) {
        throw new AppError('No configuration file found in search paths', 'CONFIG_NOT_FOUND');
      }
      filePath = foundPath;
    }

    if (!fs.existsSync(filePath)) {
      throw new AppError(`Configuration file not found: ${filePath}`, 'CONFIG_NOT_FOUND');
    }

    const ext = path.extname(filePath).toLowerCase();
    let configData: Record<string, unknown>;

    if (ext === '.md' || ext === '.markdown') {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(content);
      configData = {
        ...(parsed.data as Record<string, unknown>),
        ...(parsed.content.trim() && {
          agent: {
            ...((parsed.data as Record<string, unknown>).agent as Record<string, unknown>),
            systemPrompt: parsed.content.trim(),
          },
        }),
      };
    } else if (ext === '.json') {
      const content = fs.readFileSync(filePath, 'utf-8');
      configData = JSON.parse(content) as Record<string, unknown>;
    } else {
      throw new AppError(`Unsupported config file format: ${ext}`, 'INVALID_CONFIG_FORMAT');
    }

    if (options.validate ?? true) {
      try {
        return validateAgentForgeConfig(configData);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issues = error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(', ');
          throw new ValidationError(`Configuration validation failed: ${issues}`);
        }
        throw error;
      }
    }

    return configData as AgentForgeConfig;
  }

  /**
   * Merge multiple configurations
   */
  mergeConfigs(
    base: Partial<AgentForgeConfig>,
    ...overlays: Partial<AgentForgeConfig>[]
  ): AgentForgeConfig {
    let result = { ...base } as Record<string, unknown>;

    for (const overlay of overlays) {
      const overlayRecord = overlay as Record<string, unknown>;
      result = {
        ...result,
        ...overlay,
        agent: {
          ...((result.agent as Record<string, unknown>) || {}),
          ...((overlayRecord.agent as Record<string, unknown>) || {}),
          tools: [
            ...(((result.agent as Record<string, unknown> | undefined)?.tools as unknown[]) || []),
            ...(((overlay.agent as Record<string, unknown> | undefined)?.tools as unknown[]) || []),
          ],
          plugins: [
            ...(((result.agent as Record<string, unknown> | undefined)?.plugins as unknown[]) ||
              []),
            ...(((overlay.agent as Record<string, unknown> | undefined)?.plugins as unknown[]) ||
              []),
          ],
          middleware: [
            ...(((result.agent as Record<string, unknown> | undefined)?.middleware as unknown[]) ||
              []),
            ...(((overlay.agent as Record<string, unknown> | undefined)?.middleware as unknown[]) ||
              []),
          ],
        },
        server: {
          ...((result.server as Record<string, unknown>) || {}),
          ...((overlayRecord.server as Record<string, unknown>) || {}),
        },
        model: {
          ...((result.model as Record<string, unknown>) || {}),
          ...((overlayRecord.model as Record<string, unknown>) || {}),
        },
      };
    }

    return validateAgentForgeConfig(result);
  }
}

/**
 * Helper function to load config quickly
 */
export function loadConfig(options?: LoadConfigOptions): Promise<AgentForgeConfig> {
  const loader = new ConfigLoader();
  return loader.loadConfig(options);
}

/**
 * Helper function to load config synchronously
 */
export function loadConfigSync(options?: LoadConfigOptions): AgentForgeConfig {
  const loader = new ConfigLoader();
  return loader.loadConfigSync(options);
}
