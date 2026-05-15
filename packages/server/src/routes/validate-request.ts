/** Maximum request body size in bytes (1 MB) */
export const MAX_BODY_SIZE = 1024 * 1024;

export interface ValidatedRequest {
  valid: true;
  input: string;
  sessionId?: string;
}

export interface ValidationError {
  valid: false;
  status: number;
  error: string;
}

export type ValidationResult = ValidatedRequest | ValidationError;

/**
 * Validates the parsed request body for agent run/stream/resume endpoints.
 * Returns a typed discriminated union so callers can branch cleanly.
 */
export function validateAgentRunRequest(body: unknown): ValidationResult {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, status: 400, error: "Request body must be a JSON object" };
  }

  const obj = body as Record<string, unknown>;

  // input is required and must be a non-empty string
  if (!("input" in obj)) {
    return { valid: false, status: 400, error: "Missing required field: input" };
  }

  const input = obj.input;

  if (typeof input !== "string") {
    return { valid: false, status: 400, error: "Field \"input\" must be a string" };
  }

  if (input.length === 0) {
    return { valid: false, status: 400, error: "Field \"input\" must not be empty" };
  }

  // sessionId is optional but if present must be a string
  if ("sessionId" in obj && obj.sessionId !== undefined && typeof obj.sessionId !== "string") {
    return { valid: false, status: 400, error: "Field \"sessionId\" must be a string" };
  }

  return {
    valid: true,
    input,
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
  };
}
