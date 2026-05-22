import type { MiddlewareHandler } from 'hono';

function generateRequestId(): string {
  // UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sanitizeRequestId(id: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = id.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 64);
  return cleaned || generateRequestId();
}

function formatJson(entry: {
  ts: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  requestId: string;
  userAgent: string;
}): string {
  return JSON.stringify(entry);
}

function formatPretty(entry: {
  ts: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  requestId: string;
  userAgent: string;
}): string {
  return `${entry.method} ${entry.path} → ${entry.status} [${entry.ms.toFixed(1)}ms] requestId=${entry.requestId}`;
}

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const format = (process.env.LOG_FORMAT ?? 'json').toLowerCase();

  if (format === 'silent') {
    try {
      await next();
    } finally {
      // nothing to log
    }
    return;
  }

  const start = performance.now();
  const rawRequestId = c.req.header('X-Request-Id');
  const requestId = rawRequestId ? sanitizeRequestId(rawRequestId) : generateRequestId();
  c.header('X-Request-Id', requestId);

  try {
    await next();
  } finally {
    const ms = performance.now() - start;
    const entry = {
      ts: new Date().toISOString(),
      method: c.req.method,
      path: c.req.path,
      status: c.res?.status ?? 500,
      ms,
      requestId,
      userAgent: c.req.header('User-Agent') ?? '',
    };

    if (format === 'pretty') {
      console.log(formatPretty(entry));
    } else {
      // default: json
      console.log(formatJson(entry));
    }
  }
};
