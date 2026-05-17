import { Hono } from 'hono';
import type { ModelFactory } from '@primo-ai/core';

export function providerRoutes(modelFactory?: ModelFactory): Hono {
  const app = new Hono();

  // GET / — list registered gateways
  app.get('/', (c) => {
    if (!modelFactory) return c.json([]);
    const gateways = modelFactory.listGateways();
    return c.json(gateways.map(gw => ({ name: gw.name })));
  });

  return app;
}
