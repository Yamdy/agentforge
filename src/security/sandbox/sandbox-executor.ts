/**
 * AgentForge Sandbox Executor
 */

import type { SerializedError } from '../../core/events.js';
import type { ToolRegistry } from '../../core/interfaces.js';

export type SandboxCommand = {
  toolName: string;
  args: Record<string, unknown>;
};

export type SandboxContext = {
  sessionId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  toolRegistry?: ToolRegistry;
};

export interface SandboxConfig {
  filesystem: {
    allowedPaths: string[];
    deniedPaths: string[];
    readOnlyPaths: string[];
  };
  network: {
    allowedDomains: string[];
    deniedDomains: string[];
    allowOutbound: boolean;
  };
  compute: {
    maxCpuMs: number;
    maxMemoryMb: number;
    timeoutMs: number;
  };
}

export type SandboxResult = {
  success: boolean;
  result?: string;
  error?: SerializedError;
  durationMs: number;
  violations?: Array<
    | { type: 'path_violation'; path: string; mode: 'read' | 'write' }
    | { type: 'network_violation'; domain: string }
    | { type: 'timeout'; timeoutMs: number }
    | { type: 'memory_violation'; memoryMb: number }
  >;
};

export type SandboxViolation =
  | { type: 'path_violation'; path: string; mode: 'read' | 'write' }
  | { type: 'network_violation'; domain: string }
  | { type: 'timeout'; timeoutMs: number }
  | { type: 'memory_violation'; memoryMb: number };

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  filesystem: {
    allowedPaths: [],
    deniedPaths: ['/etc', '/var', '/tmp', '/root', '~/.ssh', '~/.gnupg'],
    readOnlyPaths: [],
  },
  network: {
    allowedDomains: [],
    deniedDomains: [],
    allowOutbound: false,
  },
  compute: {
    maxCpuMs: 30000,
    maxMemoryMb: 256,
    timeoutMs: 60000,
  },
};

export interface SandboxExecutor {
  execute(command: SandboxCommand, context: SandboxContext): Promise<SandboxResult>;
}
