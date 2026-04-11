import { AIAdapter, RequestInterceptor, TimeoutConfig } from '../src/index.js';

const inferhubAuthInterceptor: RequestInterceptor = {
  beforeRequest(ctx) {
    const token = process.env.X_AUTH_TOKEN || process.env.INFERHUB_AUTH_TOKEN || '';
    ctx.headers['X-Auth-Token'] = token;

    if (ctx.body && typeof ctx.body === 'object') {
      const body = ctx.body as Record<string, unknown>;
      const appId = process.env.INFERHUB_APP_ID;
      const sessionId = process.env.INFERHUB_SESSION_ID;

      if (appId) {
        body['app_id'] = appId;
      }
      if (sessionId) {
        body['session_id'] = sessionId;
      }
    }

    return ctx;
  },
};

const inferhubTimeout: TimeoutConfig = {
  total: 120000,
  firstToken: 60000,
  chunk: 30000,
};

const adapter = new AIAdapter({
  model: process.env.INFERHUB_MODEL || 'deepseek-r1',
  apiKey: 'placeholder',
  baseURL: process.env.INFERHUB_BASE_URL || 'https://inferhub.example.com/v1',
  interceptors: [inferhubAuthInterceptor],
  timeout: inferhubTimeout,
  tlsRejectUnauthorized: false,
});

console.log('Inferhub adapter created with interceptors:', {
  interceptors: adapter ? 'configured' : 'none',
});
