/**
 * Doom Loop Detector
 *
 * Detects infinite tool-call loops where the agent repeatedly calls
 * the same tool with identical arguments. Reference: OpenCode's
 * doom_loop permission — 3 consecutive identical tool calls
 * triggers intervention.
 */

export interface DoomLoopDetails {
  toolName: string;
  repeatCount: number;
}

export interface DoomLoopDetector {
  record(toolName: string, args: Record<string, unknown>): void;
  isDoomLoop(): boolean;
  getDetails(): DoomLoopDetails | null;
  reset(): void;
}

const MAX_REPEAT = 3;

export function createDoomLoopDetector(): DoomLoopDetector {
  let lastToolName = '';
  let lastArgsJson = '';
  let repeatCount = 0;

  function record(toolName: string, args: Record<string, unknown>): void {
    const argsJson = JSON.stringify(args);
    if (toolName === lastToolName && argsJson === lastArgsJson) {
      repeatCount++;
    } else {
      lastToolName = toolName;
      lastArgsJson = argsJson;
      repeatCount = 1;
    }
  }

  function isDoomLoop(): boolean {
    return repeatCount >= MAX_REPEAT;
  }

  function getDetails(): DoomLoopDetails | null {
    if (repeatCount >= MAX_REPEAT) {
      return { toolName: lastToolName, repeatCount };
    }
    return null;
  }

  function reset(): void {
    lastToolName = '';
    lastArgsJson = '';
    repeatCount = 0;
  }

  return { record, isDoomLoop, getDetails, reset };
}
