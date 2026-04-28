/**
 * OpenAPI Specification for AgentForge Server
 *
 * @module
 */

export const openAPISpec = {
  openapi: '3.0.3',
  info: {
    title: 'AgentForge API',
    version: '0.1.0',
    description: 'HTTP/SSE server for AgentForge Studio',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  paths: {
    '/api/sessions': {
      post: {
        summary: 'Create a new session',
        tags: ['Sessions'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  agentConfigId: { type: 'string', description: 'Agent config ID' },
                  configOverrides: { type: 'object', description: 'Config overrides' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Session created' },
        },
      },
      get: {
        summary: 'List all sessions',
        tags: ['Sessions'],
        responses: {
          '200': { description: 'List of sessions' },
        },
      },
    },
    '/api/sessions/{id}': {
      get: {
        summary: 'Get a session',
        tags: ['Sessions'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'eventLimit', in: 'query', schema: { type: 'integer' } },
          { name: 'eventOffset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Session details' },
          '404': { description: 'Session not found' },
        },
      },
      delete: {
        summary: 'Delete a session',
        tags: ['Sessions'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '204': { description: 'Session deleted' },
          '404': { description: 'Session not found' },
        },
      },
    },
    '/api/sessions/{id}/chat/stream': {
      post: {
        summary: 'Stream chat with agent (SSE)',
        tags: ['Chat'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: { type: 'string', description: 'User message' },
                },
                required: ['message'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'SSE stream of agent events',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
    },
    '/api/sessions/{id}/hitl/answer': {
      post: {
        summary: 'Provide HITL answer',
        tags: ['HITL'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  askId: { type: 'string', description: 'Ask ID from hitl.ask event' },
                  answer: { type: 'string', description: 'Human answer' },
                },
                required: ['askId', 'answer'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Answer accepted' },
        },
      },
    },
    '/api/sessions/{id}/cancel': {
      post: {
        summary: 'Cancel active run',
        tags: ['Sessions'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Run cancelled' },
          '409': { description: 'No active run' },
        },
      },
    },
    '/api/agents': {
      get: {
        summary: 'List all agent configs',
        tags: ['Agents'],
        responses: {
          '200': { description: 'List of agent configs' },
        },
      },
    },
    '/api/agents/{id}': {
      get: {
        summary: 'Get agent config',
        tags: ['Agents'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Agent config' },
          '404': { description: 'Agent config not found' },
        },
      },
      put: {
        summary: 'Save agent config',
        tags: ['Agents'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
        responses: {
          '200': { description: 'Agent config saved' },
        },
      },
      delete: {
        summary: 'Delete agent config',
        tags: ['Agents'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '204': { description: 'Agent config deleted' },
          '404': { description: 'Agent config not found' },
        },
      },
    },
    '/api/config': {
      get: {
        summary: 'Get server config',
        tags: ['Config'],
        responses: {
          '200': { description: 'Server config' },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['Health'],
        responses: {
          '200': { description: 'Health status' },
        },
      },
    },
    '/ready': {
      get: {
        summary: 'Readiness check',
        tags: ['Health'],
        responses: {
          '200': { description: 'Readiness status' },
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'Metrics',
        tags: ['Health'],
        responses: {
          '200': { description: 'Metrics data' },
        },
      },
    },
  },
};
