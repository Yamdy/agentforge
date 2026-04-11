import type { Logger as FrameworkLogger } from '../logger/index.js';
import { createLogger } from '../logger/index.js';
import type { Tracer } from '../tracer.js';
import type { Agent } from '../agent/agent.js';

export type Logger = FrameworkLogger;

export interface PluginConfig {
  plugins: string[];
}

export interface PluginContext {
  config: PluginConfig;
  logger: Logger;
  directory: string;
  tracer?: Tracer;
  agent?: Agent;
}

const defaultLogger = createLogger('plugin');

export function createPluginContext(config: PluginConfig, directory: string = process.cwd(), tracer?: Tracer, agent?: Agent): PluginContext {
  return {
    config,
    logger: defaultLogger,
    directory,
    tracer,
    agent,
  };
}
