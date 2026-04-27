import type { RequestContext } from './types.js';

/**
 * HTTP route handler function.
 */
export type Handler = (ctx: RequestContext) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

/**
 * Simple URL pattern router.
 *
 * Converts path patterns like `/api/sessions/:id` to regex patterns
 * for matching. Supports query string parsing.
 */
export class Router {
  private routes: Route[] = [];

  /**
   * Register a route.
   *
   * @param method - HTTP method (GET, POST, PUT, DELETE)
   * @param path - URL pattern with `:param` placeholders
   * @param handler - Handler function
   */
  add(method: string, path: string, handler: Handler): void {
    const paramNames: string[] = [];
    const pattern = path.replace(/:(\w+)/g, (_match, name: string) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${pattern}$`),
      paramNames,
      handler,
    });
  }

  /**
   * Resolve a request to a handler.
   *
   * @param method - HTTP method
   * @param path - URL path (may include query string)
   * @returns Handler with extracted params, or null if no match
   */
  resolve(
    method: string,
    path: string,
  ): { handler: Handler; params: Record<string, string>; query: Record<string, string> } | null {
    // Separate path from query string
    const questionMark = path.indexOf('?');
    const pathname = questionMark >= 0 ? path.slice(0, questionMark) : path;
    const search = questionMark >= 0 ? path.slice(questionMark + 1) : '';

    // Parse query string
    const query: Record<string, string> = {};
    if (search) {
      for (const pair of search.split('&')) {
        const eq = pair.indexOf('=');
        if (eq >= 0) {
          const key = decodeURIComponent(pair.slice(0, eq));
          const value = decodeURIComponent(pair.slice(eq + 1));
          query[key] = value;
        } else {
          query[decodeURIComponent(pair)] = '';
        }
      }
    }

    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      const match = pathname.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]!);
        });
        return { handler: route.handler, params, query };
      }
    }

    return null;
  }
}