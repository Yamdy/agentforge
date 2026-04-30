/**
 * @deprecated Backward-compat stub for operators.
 * All operators have been replaced by the imperative agent loop + hook system.
 * Presets now apply hook registrations instead of Observable pipelines.
 */
import type { AgentEvent } from '../core/events.js';
import type { HookRegistry } from '../core/hooks.js';
import type { AgentEventEmitter } from '../core/events.js';

// Generic stream type to replace Observable dependency
type Stream<_T> = any;

// ============================
// Identity stubs
// ============================

export function filterEventType() { return (s: Stream<any>) => s; }
export function filterEventTypePrefix() { return (s: Stream<any>) => s; }
export function takeUntilTerminal() { return (s: Stream<any>) => s; }
export function onTerminal() { return (s: Stream<any>) => s; }
export function tapEvent() { return (s: Stream<any>) => s; }
export function tapEvents() { return (s: Stream<any>) => s; }
export function collectMetrics() { return (s: Stream<any>) => s; }
export function groupByStep() { return (s: Stream<any>) => s; }
export function dedupeEventTypes() { return (s: Stream<any>) => s; }
export function transformLLMParams() { return (s: Stream<any>) => s; }
export function transformToolArgs() { return (s: Stream<any>) => s; }
export function compressMessages() { return (s: Stream<any>) => s; }
export function injectSystemPrompt() { return (s: Stream<any>) => s; }
export function logEvents() { return (s: Stream<any>) => s; }
export function traceEvents() { return (s: Stream<any>) => s; }
export function recordMetrics() { return (s: Stream<any>) => s; }
export function exportEvents() { return (s: Stream<any>) => s; }
export function checkpoint() { return (s: Stream<any>) => s; }
export function retryOnEventType() { return (s: Stream<any>) => s; }
export function timeoutOnEventType() { return (s: Stream<any>) => s; }
export function requirePermission() { return (s: Stream<any>) => s; }
export function maxStepsLimit() { return (s: Stream<any>) => s; }
export function pauseOnSignal() { return (s: Stream<any>) => s; }
export function eventToString() { return (s: Stream<any>) => s; }
export function withLatency() { return (s: Stream<any>) => s; }

// ============================
// Presets
// ============================

export function productionPreset(
  _registry: HookRegistry,
  _emitter: AgentEventEmitter,
  _config?: unknown
): void {}

export function debugPreset(
  _registry: HookRegistry,
  _emitter: AgentEventEmitter,
  _config?: unknown
): void {}

export function testPreset(
  _registry: HookRegistry,
  _emitter: AgentEventEmitter,
  _config?: unknown
): void {}

export function developmentPreset(
  _registry: HookRegistry,
  _emitter: AgentEventEmitter,
  _config?: unknown
): void {}

export function createPreset(
  _registry: HookRegistry,
  _emitter: AgentEventEmitter,
  _config?: unknown
): void {}

// ============================
// Legacy type exports
// ============================

export type AgentMetrics = Record<string, number>;
export type LLMTransformParams = Record<string, unknown>;
export type EventWithLatency = AgentEvent & { latency: number };
export type Logger = { log: (msg: string) => void };
export type ProductionPresetConfig = Record<string, unknown>;
export type DebugPresetConfig = Record<string, unknown>;
export type TestPresetConfig = Record<string, unknown>;
