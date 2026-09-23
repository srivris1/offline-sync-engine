import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRoutes from './api/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/v1', apiRoutes);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'Offline Sync Engine',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/docs', (_req, res) => {
  res.send(getSwaggerHTML());
});

app.get('/api/openapi.json', (_req, res) => {
  res.json(getOpenAPISpec());
});

app.get('/simulator', (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, 'simulator', 'index.html'), 'utf-8');
    res.type('html').send(html);
  } catch {
    res.type('html').send(getSimulatorHTML());
  }
});

app.get('/', (_req, res) => {
  res.json({
    name: 'Offline Sync Engine',
    description: 'A distributed synchronization backend with Vector Clocks, 3-way field-level merging, and conflict detection.',
    endpoints: {
      health: '/api/health',
      docs: '/docs',
      simulator: '/simulator',
      api: {
        listDocuments: 'GET /api/v1/documents',
        createDocument: 'POST /api/v1/documents',
        getDocument: 'GET /api/v1/documents/:id',
        deleteDocument: 'DELETE /api/v1/documents/:id',
        syncDocument: 'POST /api/v1/sync',
        documentHistory: 'GET /api/v1/documents/:id/history',
        documentRevision: 'GET /api/v1/documents/:id/revisions/:version',
        restoreDocument: 'POST /api/v1/documents/:id/restore/:version',
      },
    },
  });
});

app.listen(PORT, () => {
  console.log(`Offline Sync Engine running on http://localhost:${PORT}`);
  console.log(`API Docs: http://localhost:${PORT}/docs`);
  console.log(`Simulator: http://localhost:${PORT}/simulator`);
});

function getOpenAPISpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Offline Sync Engine API',
      version: '1.0.0',
      description: 'A distributed synchronization backend that handles concurrent modifications from multiple devices using Vector Clocks and 3-way field-level merging.',
    },
    servers: [{ url: '/api/v1', description: 'API v1' }],
    paths: {
      '/documents': {
        get: {
          summary: 'List all documents',
          tags: ['Documents'],
          responses: { '200': { description: 'List of documents' } },
        },
        post: {
          summary: 'Create a new document',
          tags: ['Documents'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object' }, deviceId: { type: 'string' }, deviceName: { type: 'string' } }, required: ['data'] } } },
          },
          responses: { '201': { description: 'Document created' } },
        },
      },
      '/documents/{id}': {
        get: {
          summary: 'Get a document by ID',
          tags: ['Documents'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Document details' }, '404': { description: 'Not found' } },
        },
        delete: {
          summary: 'Soft-delete a document',
          tags: ['Documents'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
        },
      },
      '/sync': {
        post: {
          summary: 'Synchronize a document change',
          tags: ['Sync'],
          description: 'Submit a change from a device. The server detects conflicts using Vector Clocks and attempts 3-way field-level merge. Returns ACCEPTED, AUTO_MERGED, CONFLICT_RESOLVED_LWW, CONFLICT_REQUIRES_RESOLUTION, REJECTED_STALE, or DUPLICATE_MUTATION.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    documentId: { type: 'string' },
                    deviceId: { type: 'string' },
                    deviceName: { type: 'string' },
                    mutationId: { type: 'string', format: 'uuid' },
                    baseVersion: { type: 'integer' },
                    baseClock: { type: 'object', additionalProperties: { type: 'integer' } },
                    data: { type: 'object' },
                    conflictResolution: { type: 'string', enum: ['lww', 'manual'] },
                  },
                  required: ['documentId', 'deviceId', 'mutationId', 'data'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Sync succeeded (ACCEPTED, AUTO_MERGED, or CONFLICT_RESOLVED_LWW)' },
            '409': { description: 'Conflict detected (CONFLICT_REQUIRES_RESOLUTION or REJECTED_STALE)' },
            '400': { description: 'Invalid request' },
          },
        },
      },
      '/documents/{id}/history': {
        get: {
          summary: 'Get document revision history',
          tags: ['History'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Revision history' } },
        },
      },
      '/documents/{id}/revisions/{version}': {
        get: {
          summary: 'Get a specific revision snapshot (time travel)',
          tags: ['History'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'version', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'Revision data' }, '404': { description: 'Not found' } },
        },
      },
      '/documents/{id}/restore/{version}': {
        post: {
          summary: 'Restore document to a previous version',
          tags: ['History'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'version', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object', properties: { deviceId: { type: 'string' }, deviceName: { type: 'string' } } } } },
          },
          responses: { '200': { description: 'Restored' } },
        },
      },
    },
  };
}

function getSwaggerHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Offline Sync Engine — API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui', deepLinking: true, presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset], layout: 'BaseLayout' });
  </script>
</body>
</html>`;
}

function getSimulatorHTML(): string {
  return '<html><body><h1>Simulator</h1><p>Loading...</p></body></html>';
}

export default app;
