import { v4 as uuidv4 } from 'uuid';
import { type VectorClock, createClock, increment, merge, compare, CausalOrder, serialize } from '../core/vector-clock.js';
import { threeWayMerge, computeFieldDiff, type DocumentFields } from '../core/merger.js';

export interface Revision {
  version: number;
  clock: VectorClock;
  data: DocumentFields;
  deviceId: string;
  deviceName: string;
  mutationId: string;
  diff: Record<string, { from: unknown; to: unknown }>;
  timestamp: string;
}

export interface Document {
  id: string;
  data: DocumentFields;
  clock: VectorClock;
  version: number;
  revisions: Revision[];
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SyncStatus =
  | 'ACCEPTED'
  | 'AUTO_MERGED'
  | 'CONFLICT_RESOLVED_LWW'
  | 'CONFLICT_REQUIRES_RESOLUTION'
  | 'REJECTED_STALE'
  | 'REJECTED_INVALID'
  | 'DUPLICATE_MUTATION'
  | 'CREATED';

export interface SyncResponse {
  status: SyncStatus;
  documentId: string;
  version: number;
  clock: VectorClock;
  data: DocumentFields;
  mergedFields?: string[];
  conflicts?: Array<{
    field: string;
    ancestor: unknown;
    current: unknown;
    incoming: unknown;
  }>;
  message: string;
}

export interface SyncRequest {
  documentId: string;
  deviceId: string;
  deviceName: string;
  mutationId: string;
  baseVersion: number;
  baseClock: VectorClock;
  data: DocumentFields;
  conflictResolution?: 'lww' | 'manual';
}

const documents = new Map<string, Document>();
const mutationCache = new Map<string, SyncResponse>();
const documentLocks = new Map<string, Promise<void>>();

async function acquireLock(docId: string): Promise<() => void> {
  while (documentLocks.has(docId)) {
    await documentLocks.get(docId);
  }

  let unlock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  documentLocks.set(docId, lockPromise);

  return () => {
    documentLocks.delete(docId);
    unlock!();
  };
}

export function createDocument(data: DocumentFields, deviceId: string, deviceName: string): Document {
  const id = uuidv4();
  const clock = increment(createClock(), deviceId);
  const now = new Date().toISOString();

  const doc: Document = {
    id,
    data: { ...data },
    clock,
    version: 1,
    revisions: [{
      version: 1,
      clock: { ...clock },
      data: { ...data },
      deviceId,
      deviceName,
      mutationId: uuidv4(),
      diff: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { from: undefined, to: v }])),
      timestamp: now,
    }],
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };

  documents.set(id, doc);
  return doc;
}

export async function syncDocument(req: SyncRequest): Promise<SyncResponse> {
  if (!req.documentId || !req.deviceId || !req.mutationId || !req.data) {
    return {
      status: 'REJECTED_INVALID',
      documentId: req.documentId || '',
      version: 0,
      clock: {},
      data: {},
      message: 'Missing required fields: documentId, deviceId, mutationId, and data are required.',
    };
  }

  const cached = mutationCache.get(req.mutationId);
  if (cached) {
    return { ...cached, status: 'DUPLICATE_MUTATION', message: 'This mutation was already processed. Returning cached result.' };
  }

  const unlock = await acquireLock(req.documentId);

  try {
    const doc = documents.get(req.documentId);
    if (!doc) {
      return {
        status: 'REJECTED_INVALID',
        documentId: req.documentId,
        version: 0,
        clock: {},
        data: {},
        message: `Document '${req.documentId}' not found.`,
      };
    }

    if (doc.deleted) {
      return {
        status: 'REJECTED_INVALID',
        documentId: req.documentId,
        version: doc.version,
        clock: doc.clock,
        data: {},
        message: 'Cannot sync to a deleted document.',
      };
    }

    const incomingClock = increment(req.baseClock, req.deviceId);
    const order = compare(incomingClock, doc.clock);

    if (order === CausalOrder.BEFORE) {
      return {
        status: 'REJECTED_STALE',
        documentId: doc.id,
        version: doc.version,
        clock: doc.clock,
        data: doc.data,
        message: `Stale update rejected. Your base version ${req.baseVersion} is behind server version ${doc.version}. Fetch the latest version first.`,
      };
    }

    if (order === CausalOrder.AFTER || order === CausalOrder.EQUAL) {
      const diff = computeFieldDiff(doc.data, req.data);
      const newClock = merge(doc.clock, incomingClock);
      const newVersion = doc.version + 1;
      const now = new Date().toISOString();

      const revision: Revision = {
        version: newVersion,
        clock: { ...newClock },
        data: { ...req.data },
        deviceId: req.deviceId,
        deviceName: req.deviceName,
        mutationId: req.mutationId,
        diff,
        timestamp: now,
      };

      doc.data = { ...req.data };
      doc.clock = newClock;
      doc.version = newVersion;
      doc.revisions.push(revision);
      doc.updatedAt = now;

      const response: SyncResponse = {
        status: 'ACCEPTED',
        documentId: doc.id,
        version: newVersion,
        clock: newClock,
        data: doc.data,
        message: 'Change accepted as a direct fast-forward update.',
      };

      mutationCache.set(req.mutationId, response);
      scheduleMutationCacheCleanup(req.mutationId);
      return response;
    }

    const ancestor = findAncestor(doc, req.baseVersion);

    const mergeResult = threeWayMerge(ancestor, doc.data, req.data);

    if (mergeResult.strategy === 'no_changes') {
      const response: SyncResponse = {
        status: 'ACCEPTED',
        documentId: doc.id,
        version: doc.version,
        clock: doc.clock,
        data: doc.data,
        message: 'No effective changes detected.',
      };
      mutationCache.set(req.mutationId, response);
      return response;
    }

    if (mergeResult.strategy === 'auto_merged') {
      const newClock = merge(doc.clock, incomingClock);
      const newVersion = doc.version + 1;
      const now = new Date().toISOString();
      const diff = computeFieldDiff(doc.data, mergeResult.merged);

      const revision: Revision = {
        version: newVersion,
        clock: { ...newClock },
        data: { ...mergeResult.merged },
        deviceId: req.deviceId,
        deviceName: req.deviceName,
        mutationId: req.mutationId,
        diff,
        timestamp: now,
      };

      doc.data = { ...mergeResult.merged };
      doc.clock = newClock;
      doc.version = newVersion;
      doc.revisions.push(revision);
      doc.updatedAt = now;

      const response: SyncResponse = {
        status: 'AUTO_MERGED',
        documentId: doc.id,
        version: newVersion,
        clock: newClock,
        data: doc.data,
        mergedFields: mergeResult.autoMergedFields,
        message: `Concurrent changes auto-merged. Fields merged from your device: [${mergeResult.autoMergedFields.join(', ')}]. No conflicts.`,
      };

      mutationCache.set(req.mutationId, response);
      scheduleMutationCacheCleanup(req.mutationId);
      return response;
    }

    if (req.conflictResolution === 'lww') {
      const conflictFields = mergeResult.conflicts.map(c => c.field);
      const lwwData = { ...mergeResult.merged };
      for (const c of mergeResult.conflicts) {
        lwwData[c.field] = c.incoming;
      }

      const newClock = merge(doc.clock, incomingClock);
      const newVersion = doc.version + 1;
      const now = new Date().toISOString();
      const diff = computeFieldDiff(doc.data, lwwData);

      const revision: Revision = {
        version: newVersion,
        clock: { ...newClock },
        data: { ...lwwData },
        deviceId: req.deviceId,
        deviceName: req.deviceName,
        mutationId: req.mutationId,
        diff,
        timestamp: now,
      };

      doc.data = { ...lwwData };
      doc.clock = newClock;
      doc.version = newVersion;
      doc.revisions.push(revision);
      doc.updatedAt = now;

      const response: SyncResponse = {
        status: 'CONFLICT_RESOLVED_LWW',
        documentId: doc.id,
        version: newVersion,
        clock: newClock,
        data: doc.data,
        mergedFields: mergeResult.autoMergedFields,
        conflicts: mergeResult.conflicts,
        message: `Conflicts on fields [${conflictFields.join(', ')}] resolved using Last-Write-Wins strategy.`,
      };

      mutationCache.set(req.mutationId, response);
      scheduleMutationCacheCleanup(req.mutationId);
      return response;
    }

    const response: SyncResponse = {
      status: 'CONFLICT_REQUIRES_RESOLUTION',
      documentId: doc.id,
      version: doc.version,
      clock: doc.clock,
      data: doc.data,
      mergedFields: mergeResult.autoMergedFields,
      conflicts: mergeResult.conflicts,
      message: `Concurrent modification detected. ${mergeResult.autoMergedFields.length} field(s) auto-merged, but ${mergeResult.conflicts.length} field(s) have true conflicts requiring manual resolution.`,
    };

    mutationCache.set(req.mutationId, response);
    scheduleMutationCacheCleanup(req.mutationId);
    return response;

  } finally {
    unlock();
  }
}

function findAncestor(doc: Document, baseVersion: number): DocumentFields {
  const rev = doc.revisions.find(r => r.version === baseVersion);
  if (rev) return { ...rev.data };
  if (doc.revisions.length > 0) return { ...doc.revisions[0].data };
  return {};
}

function scheduleMutationCacheCleanup(mutationId: string): void {
  setTimeout(() => {
    mutationCache.delete(mutationId);
  }, 24 * 60 * 60 * 1000);
}

export function getDocument(id: string): Document | undefined {
  return documents.get(id);
}

export function getAllDocuments(): Document[] {
  return Array.from(documents.values()).filter(d => !d.deleted);
}

export function getDocumentRevision(docId: string, version: number): Revision | undefined {
  const doc = documents.get(docId);
  if (!doc) return undefined;
  return doc.revisions.find(r => r.version === version);
}

export function getDocumentHistory(docId: string): Revision[] {
  const doc = documents.get(docId);
  if (!doc) return [];
  return [...doc.revisions];
}

export async function restoreDocument(docId: string, targetVersion: number, deviceId: string, deviceName: string): Promise<SyncResponse> {
  const unlock = await acquireLock(docId);
  try {
    const doc = documents.get(docId);
    if (!doc) {
      return {
        status: 'REJECTED_INVALID',
        documentId: docId,
        version: 0,
        clock: {},
        data: {},
        message: 'Document not found.',
      };
    }

    const targetRevision = doc.revisions.find(r => r.version === targetVersion);
    if (!targetRevision) {
      return {
        status: 'REJECTED_INVALID',
        documentId: docId,
        version: doc.version,
        clock: doc.clock,
        data: doc.data,
        message: `Revision ${targetVersion} not found.`,
      };
    }

    const newClock = increment(doc.clock, deviceId);
    const newVersion = doc.version + 1;
    const now = new Date().toISOString();
    const diff = computeFieldDiff(doc.data, targetRevision.data);

    const revision: Revision = {
      version: newVersion,
      clock: { ...newClock },
      data: { ...targetRevision.data },
      deviceId,
      deviceName,
      mutationId: uuidv4(),
      diff,
      timestamp: now,
    };

    doc.data = { ...targetRevision.data };
    doc.clock = newClock;
    doc.version = newVersion;
    doc.revisions.push(revision);
    doc.updatedAt = now;

    return {
      status: 'ACCEPTED',
      documentId: doc.id,
      version: newVersion,
      clock: newClock,
      data: doc.data,
      message: `Document restored to version ${targetVersion}.`,
    };
  } finally {
    unlock();
  }
}

export async function deleteDocument(docId: string): Promise<boolean> {
  const unlock = await acquireLock(docId);
  try {
    const doc = documents.get(docId);
    if (!doc) return false;
    doc.deleted = true;
    doc.updatedAt = new Date().toISOString();
    return true;
  } finally {
    unlock();
  }
}

export function clearAll(): void {
  documents.clear();
  mutationCache.clear();
}
