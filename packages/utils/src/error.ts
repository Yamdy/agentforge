/**
 * Error handling utility functions
 */

/**
 * Ensure the error is an Error instance
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  
  if (typeof error === 'string') {
    return new Error(error);
  }
  
  return new Error(String(error));
}

/**
 * Get error message from an unknown error
 */
export function getErrorMessage(error: unknown): string {
  return toError(error).message;
}

/**
 * Create an error with a code property
 */
export class CodeError extends Error {
  code: string;
  
  constructor(message: string, code: string) {
    super(message);
    this.name = 'CodeError';
    this.code = code;
    Object.setPrototypeOf(this, CodeError.prototype);
  }
}

/**
 * Check if an error has a specific code
 */
export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as any).code === code;
}
