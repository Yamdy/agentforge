import { Logger as FrameworkLogger, createLogger } from '../logger/index.js';
import type { Tracer } from '../tracer.js';

export type Logger = FrameworkLogger;

export interface PluginConfig {
  plugins: string[];
}

export interface PluginContext {
  config: PluginConfig;
  logger: Logger;
  directory: string;
  tracer?: Tracer;
  agent?: any;
}

export const defaultLogger = createLogger('plugin');

export function createPluginContext(config: PluginConfig, directory: string = process.cwd(), tracer?: Tracer, agent?: any): PluginContext {
  return {
    config,
    logger: defaultLogger,
    directory,
    tracer,
    agent,
  };
}
