import { Subject, Observable, filter } from 'rxjs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  service: string;
  message: string;
  meta?: Record<string, unknown>;
  traceId?: string;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(service: string): Logger;
}

export class LogService implements Logger {
  private service: string;
  private logSubject: Subject<LogEntry>;
  private minLevel: LogLevel = 'info';
  private static instance: LogService;
  private children: WeakRef<LogService>[] = [];

  private static levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(service: string = 'app', logSubject?: Subject<LogEntry>) {
    this.service = service;
    this.logSubject = logSubject ?? new Subject<LogEntry>();
  }

  static getInstance(): LogService {
    if (!LogService.instance) {
      LogService.instance = new LogService();
    }
    return LogService.instance;
  }

  static setLogSubject(subject: Subject<LogEntry>): void {
    function updateAll(current: LogService) {
      current.logSubject = subject;
      for (const ref of current.children) {
        const child = ref.deref();
        if (child) {
          updateAll(child);
        }
      }
    }
    const instance = LogService.getInstance();
    updateAll(instance);
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LogService.levelPriority[level] >= LogService.levelPriority[this.minLevel];
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      service: this.service,
      message,
      meta,
    };

    console.log(
      `[${entry.timestamp.toISOString()}] ${level.toUpperCase().padEnd(5)} [${this.service}] ${message}`,
      meta ? JSON.stringify(meta) : ''
    );

    this.logSubject.next(entry);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  child(service: string): Logger {
    const childLogger = new LogService(service, this.logSubject);
    this.children.push(new WeakRef(childLogger));
    return childLogger;
  }

  observable(): Observable<LogEntry> {
    return this.logSubject.asObservable();
  }

  observableByLevel(level: LogLevel): Observable<LogEntry> {
    return this.logSubject.pipe(
      filter((entry) => entry.level === level)
    );
  }

  observableByService(service: string): Observable<LogEntry> {
    return this.logSubject.pipe(
      filter((entry) => entry.service === service)
    );
  }
}

export function createLogger(service: string): Logger {
  return LogService.getInstance().child(service);
}

export const logger = createLogger('app');
