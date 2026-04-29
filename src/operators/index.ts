/**
 * @deprecated Backward-compat stub for operators.
 * All operators have been replaced by the imperative agent loop + hook system.
 * Presets now apply hook registrations instead of Observable pipelines.
 */
import { Observable } from 'rxjs';
import type { AgentEvent } from '../core/events.js';
import type { HookRegistry } from '../core/hooks.js';
import type { AgentEventEmitter } from '../core/events.js';

// ============================
// Identity stubs
// ============================

export function filterEventType() { return (s: Observable<any>) => s; }
export function filterEventTypePrefix() { return (s: Observable<any>) => s; }
export function takeUntilTerminal() { return (s: Observable<any>) => s; }
export function onTerminal() { return (s: Observable<any>) => s; }
export function tapEvent() { return (s: Observable<any>) => s; }
export function tapEvents() { return (s: Observable<any>) => s; }
export function collectMetrics() { return (s: Observable<any>) => s; }
export function groupByStep() { return (s: Observable<any>) => s; }
export function dedupeEventTypes() { return (s: Observable<any>) => s; }
export function transformLLMParams() { return (s: Observable<any>) => s; }
export function transformToolArgs() { return (s: Observable<any>) => s; }
export function compressMessages() { return (s: Observable<any>) => s; }
export function injectSystemPrompt() { return (s: Observable<any>) => s; }
export function logEvents() { return (s: Observable<any>) => s; }
export function traceEvents() { return (s: Observable<any>) => s; }
export function recordMetrics() { return (s: Observable<any>) => s; }
export function exportEvents() { return (s: Observable<any>) => s; }
export function checkpoint() { return (s: Observable<any>) => s; }
export function retryOnEventType() { return (s: Observable<any>) => s; }
export function timeoutOnEventType() { return (s: Observable<any>) => s; }
export function requirePermission() { return (s: Observable<any>) => s; }
export function maxStepsLimit() { return (s: Observable<any>) => s; }
export function pauseOnSignal() { return (s: Observable<any>) => s; }
export function eventToString() { return (s: Observable<any>) => s; }
export function withLatency() { return (s: Observable<any>) => s; }

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
