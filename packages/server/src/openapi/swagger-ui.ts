/**
 * Swagger UI Handler for AgentForge Server
 *
 * Serves Swagger UI for API documentation.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================
// Swagger UI Handler
// ============================================================

/**
 * Create a Swagger UI handler function.
 *
 * Returns a function that serves Swagger UI HTML page.
 *
 * @param spec - OpenAPI specification object
 * @returns Handler function that serves Swagger UI
 */
export function createSwaggerUIHandler(spec: object) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AgentForge API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        spec: ${JSON.stringify(spec)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;

  return (_req: IncomingMessage, res: ServerResponse): void => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  };
}
