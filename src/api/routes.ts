import { Router, type Request, type Response } from 'express';
import {
  createDocument,
  syncDocument,
  getDocument,
  getAllDocuments,
  getDocumentHistory,
  getDocumentRevision,
  restoreDocument,
  deleteDocument,
  type SyncRequest,
} from '../store/document-store.js';

const router = Router();

router.get('/documents', (_req: Request, res: Response) => {
  const docs = getAllDocuments();
  res.json({
    count: docs.length,
    documents: docs.map(d => ({
      id: d.id,
      data: d.data,
      version: d.version,
      clock: d.clock,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  });
});

router.post('/documents', (req: Request, res: Response) => {
  const { data, deviceId, deviceName } = req.body;

  if (!data || typeof data !== 'object') {
    res.status(400).json({ error: 'Request body must include a "data" object.' });
    return;
  }

  const doc = createDocument(
    data,
    deviceId || 'server',
    deviceName || 'API'
  );

  res.status(201).json({
    status: 'CREATED',
    documentId: doc.id,
    version: doc.version,
    clock: doc.clock,
    data: doc.data,
    message: 'Document created successfully.',
  });
});

router.get('/documents/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const doc = getDocument(id);

  if (!doc || doc.deleted) {
    res.status(404).json({ error: `Document '${id}' not found.` });
    return;
  }

  res.json({
    id: doc.id,
    data: doc.data,
    version: doc.version,
    clock: doc.clock,
    revisionCount: doc.revisions.length,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
});

router.delete('/documents/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const deleted = await deleteDocument(id);

  if (!deleted) {
    res.status(404).json({ error: `Document '${id}' not found.` });
    return;
  }

  res.json({ message: 'Document deleted (soft delete). Tombstone preserved for offline sync propagation.' });
});

router.post('/sync', async (req: Request, res: Response) => {
  const syncReq: SyncRequest = {
    documentId: req.body.documentId,
    deviceId: req.body.deviceId,
    deviceName: req.body.deviceName || 'Unknown Device',
    mutationId: req.body.mutationId,
    baseVersion: req.body.baseVersion ?? 0,
    baseClock: req.body.baseClock ?? {},
    data: req.body.data,
    conflictResolution: req.body.conflictResolution,
  };

  const result = await syncDocument(syncReq);

  const statusCodeMap: Record<string, number> = {
    ACCEPTED: 200,
    AUTO_MERGED: 200,
    CONFLICT_RESOLVED_LWW: 200,
    CREATED: 201,
    DUPLICATE_MUTATION: 200,
    CONFLICT_REQUIRES_RESOLUTION: 409,
    REJECTED_STALE: 409,
    REJECTED_INVALID: 400,
  };

  res.status(statusCodeMap[result.status] || 500).json(result);
});

router.get('/documents/:id/history', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const doc = getDocument(id);

  if (!doc) {
    res.status(404).json({ error: `Document '${id}' not found.` });
    return;
  }

  const history = getDocumentHistory(id);
  res.json({
    documentId: id,
    currentVersion: doc.version,
    revisions: history.map(r => ({
      version: r.version,
      clock: r.clock,
      deviceId: r.deviceId,
      deviceName: r.deviceName,
      mutationId: r.mutationId,
      changedFields: Object.keys(r.diff),
      timestamp: r.timestamp,
    })),
  });
});

router.get('/documents/:id/revisions/:version', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const version = parseInt(req.params.version as string, 10);

  if (isNaN(version)) {
    res.status(400).json({ error: 'Version must be a number.' });
    return;
  }

  const revision = getDocumentRevision(id, version);

  if (!revision) {
    res.status(404).json({ error: `Revision ${version} not found for document '${id}'.` });
    return;
  }

  res.json({
    documentId: id,
    revision: {
      version: revision.version,
      clock: revision.clock,
      data: revision.data,
      deviceId: revision.deviceId,
      deviceName: revision.deviceName,
      mutationId: revision.mutationId,
      diff: revision.diff,
      timestamp: revision.timestamp,
    },
  });
});

router.post('/documents/:id/restore/:version', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const version = parseInt(req.params.version as string, 10);

  if (isNaN(version)) {
    res.status(400).json({ error: 'Version must be a number.' });
    return;
  }

  const result = await restoreDocument(
    id,
    version,
    req.body.deviceId || 'server',
    req.body.deviceName || 'API Restore'
  );

  const code = result.status === 'ACCEPTED' ? 200 : 400;
  res.status(code).json(result);
});

export default router;
