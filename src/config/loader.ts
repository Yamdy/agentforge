import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { z } from 'zod';
import { AgentForgeConfigSchema } from './schema.js';
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

    let configData: any;

    if (ext === '.md' || ext === '.markdown') {
      // Load from markdown with frontmatter
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = matter(content);
      configData = {
        ...parsed.data,
        ...(parsed.content.trim() && {
          agent: {
            ...parsed.data.agent,
            systemPrompt: parsed.content.trim(),
          },
        }),
      };
    } else if (ext === '.json') {
      // Load from JSON
      const content = await fs.promises.readFile(filePath, 'utf-8');
      configData = JSON.parse(content);
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
    let configData: any;

    if (ext === '.md' || ext === '.markdown') {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(content);
      configData = {
        ...parsed.data,
        ...(parsed.content.trim() && {
          agent: {
            ...parsed.data.agent,
            systemPrompt: parsed.content.trim(),
          },
        }),
      };
    } else if (ext === '.json') {
      const content = fs.readFileSync(filePath, 'utf-8');
      configData = JSON.parse(content);
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
    let result = { ...base } as Record<string, any>;

    for (const overlay of overlays) {
      const overlayAny = overlay as Record<string, any>;
      result = {
        ...result,
        ...overlay,
        agent: {
          ...(result.agent || {}),
          ...(overlayAny.agent || {}),
          tools: [
            ...(result.agent && result.agent.tools ? result.agent.tools : []),
            ...(overlay.agent && overlay.agent.tools ? overlay.agent.tools : []),
          ],
          plugins: [
            ...(result.agent && result.agent.plugins ? result.agent.plugins : []),
            ...(overlay.agent && overlay.agent.plugins ? overlay.agent.plugins : []),
          ],
          middleware: [
            ...(result.agent && result.agent.middleware ? result.agent.middleware : []),
            ...(overlay.agent && overlay.agent.middleware ? overlay.agent.middleware : []),
          ],
        },
        server: {
          ...(result.server || {}),
          ...(overlayAny.server || {}),
        },
        model: {
          ...(result.model || {}),
          ...(overlayAny.model || {}),
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
