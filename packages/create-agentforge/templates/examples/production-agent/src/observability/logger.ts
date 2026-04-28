/**
 * Console logger for production agent (M8).
 */

import type { AgentEvent } from 'agentforge';

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class ConsoleLogger {
  private level: LogLevel = 'info';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private formatEntry(level: LogLevel, message: string, data?: unknown): LogEntry {
    return { timestamp: new Date().toISOString(), level, message, data };
  }

  private output(entry: LogEntry): void {
    const colorMap: Record<LogLevel, string> = {
      debug: '\x1b[36m',
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
    };
    const reset = '\x1b[0m';
    const levelStr = `${colorMap[entry.level]}${entry.level.toUpperCase().padEnd(5)}${reset}`;
    console.log(`[${entry.timestamp}] ${levelStr} ${entry.message}`, entry.data ?? '');
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) this.output(this.formatEntry('debug', message, data));
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) this.output(this.formatEntry('info', message, data));
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) this.output(this.formatEntry('warn', message, data));
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog('error')) this.output(this.formatEntry('error', message, data));
  }

  logEvent(event: AgentEvent): void {
    this.debug(`Event: ${event.type}`, event);
  }
}

export const logger = new ConsoleLogger();