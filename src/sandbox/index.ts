/**
 * MPU-M3: Sandbox Module Exports
 *
 * @module
 */

// Sandbox implementations
export { DockerSandbox, type DockerSandboxConfig } from './docker-sandbox.js';
export { ProcessSandbox, type ProcessSandboxConfig } from './process-sandbox.js';

// Sandbox factory (selection strategy)
export {
  createSandbox,
  createProcessSandbox,
  createNoopSandbox,
  isDockerAvailable,
  type SandboxMode,
  type SandboxFactoryConfig,
} from './factory.js';
