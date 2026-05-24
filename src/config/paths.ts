/**
 * Configuration and data directory path resolution following XDG standards.
 * Inspired by OpenHarness's configuration system.
 */

import os from 'os';
import path from 'path';

/**
 * Get the user config directory following XDG_CONFIG_HOME convention.
 * @returns Absolute path to config directory
 */
export function getConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.resolve(xdgConfigHome);
  }
  return path.resolve(os.homedir(), '.config');
}

/**
 * Get the user data directory following XDG_DATA_HOME convention.
 * @returns Absolute path to data directory
 */
export function getDataDir(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return path.resolve(xdgDataHome);
  }
  return path.resolve(os.homedir(), '.local', 'share');
}

/**
 * Get the user logs directory following XDG_STATE_HOME convention.
 * @returns Absolute path to logs directory
 */
export function getLogsDir(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return path.resolve(xdgStateHome);
  }
  return path.resolve(os.homedir(), '.local', 'state');
}

/**
 * Get the AgentForge-specific config directory.
 * Creates the directory if it doesn't exist.
 * @returns Absolute path to AgentForge config directory
 */
export function getAgentForgeConfigDir(): string {
  return path.join(getConfigDir(), 'agentforge');
}

/**
 * Get the AgentForge-specific data directory.
 * Creates the directory if it doesn't exist.
 * @returns Absolute path to AgentForge data directory
 */
export function getAgentForgeDataDir(): string {
  return path.join(getDataDir(), 'agentforge');
}

/**
 * Get the AgentForge-specific logs directory.
 * @returns Absolute path to AgentForge logs directory
 */
export function getAgentForgeLogsDir(): string {
  return path.join(getLogsDir(), 'agentforge');
}

/**
 * Get the path to the main AgentForge config file.
 * @returns Absolute path to config file
 */
export function getConfigFilePath(): string {
  return path.join(getAgentForgeConfigDir(), 'config.json');
}
