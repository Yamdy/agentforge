import pc from 'picocolors';

export class Logger {
  private prefix: string;

  constructor(prefix: string = 'agentforge') {
    this.prefix = prefix;
  }

  info(message: string, ...args: unknown[]): void {
    console.log(pc.cyan(`[${this.prefix}]`), message, ...args);
  }

  success(message: string, ...args: unknown[]): void {
    console.log(pc.green(`[${this.prefix}]`), message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(pc.yellow(`[${this.prefix}]`), message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(pc.red(`[${this.prefix}]`), message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    if (process.env.DEBUG) {
      console.log(pc.gray(`[${this.prefix}:debug]`), message, ...args);
    }
  }
}

export const logger = new Logger();
