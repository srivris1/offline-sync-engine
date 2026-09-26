import { describe, it, expect, beforeEach } from 'vitest';
import { createDocument, syncDocument, getDocument, getDocumentHistory, getDocumentRevision, restoreDocument, clearAll, type SyncRequest } from '../src/store/document-store.js';
import { v4 as uuidv4 } from 'uuid';

beforeEach(() => {
  clearAll();
});

describe('Document Creation', () => {
  it('creates a document with initial data', () => {
    const doc = createDocument({ title: 'Test', status: 'draft' }, 'deviceA', 'Phone');
    expect(doc.id).toBeDefined();
    expect(doc.version).toBe(1);
    expect(doc.data.title).toBe('Test');
    expect(doc.clock.deviceA).toBe(1);
    expect(doc.revisions).toHaveLength(1);
  });
});

describe('Fast-Forward Sync', () => {
  it('accepts a direct update when device is up to date', async () => {
    const doc = createDocument({ title: 'Hello', status: 'draft' }, 'deviceA', 'Phone');
    const result = await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'Updated', status: 'draft' },
    });
    expect(result.status).toBe('ACCEPTED');
    expect(result.version).toBe(2);
    expect(result.data.title).toBe('Updated');
  });
});

describe('Concurrent Sync — Auto Merge', () => {
  it('auto-merges when devices modify different fields', async () => {
    const doc = createDocument({ title: 'Hello', status: 'draft', notes: 'none' }, 'deviceA', 'Phone');

    await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'Title from A', status: 'draft', notes: 'none' },
    });

    const result = await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceB',
      deviceName: 'Laptop',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'Hello', status: 'published', notes: 'none' },
    });

    expect(result.status).toBe('AUTO_MERGED');
    expect(result.data.title).toBe('Title from A');
    expect(result.data.status).toBe('published');
    expect(result.mergedFields).toContain('status');
  });
});

describe('Concurrent Sync — True Conflict', () => {
  it('detects conflict when both modify same field (manual resolution)', async () => {
    const doc = createDocument({ title: 'Hello' }, 'deviceA', 'Phone');

    await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'Title A' },
    });

    const result = await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceB',
      deviceName: 'Laptop',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'Title B' },
      conflictResolution: 'manual',
    });

    expect(result.status).toBe('CONFLICT_REQUIRES_RESOLUTION');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts![0].field).toBe('title');
    expect(result.conflicts![0].current).toBe('Title A');
    expect(result.conflicts![0].incoming).toBe('Title B');
  });

  it('resolves conflict with LWW when requested', async () => {
    const doc = createDocument({ title: 'Hello' }, 'deviceA', 'Phone');

    await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'Title A' },
    });

    const result = await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceB',
      deviceName: 'Laptop',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'Title B' },
      conflictResolution: 'lww',
    });

    expect(result.status).toBe('CONFLICT_RESOLVED_LWW');
    expect(result.data.title).toBe('Title B');
  });
});

describe('Edge Cases', () => {
  it('rejects stale updates (device behind server)', async () => {
    const doc = createDocument({ title: 'v1' }, 'deviceA', 'Phone');

    await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'v2' },
    });

    await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 2,
      baseClock: { deviceA: 2 },
      data: { title: 'v3' },
    });

    const staleResult = await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceB',
      deviceName: 'Laptop',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'old update' },
      conflictResolution: 'lww',
    });

    expect(['REJECTED_STALE', 'CONFLICT_RESOLVED_LWW', 'AUTO_MERGED']).toContain(staleResult.status);
  });

  it('handles idempotent duplicate mutation', async () => {
    const doc = createDocument({ title: 'Hello' }, 'deviceA', 'Phone');
    const mutId = uuidv4();

    const first = await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: mutId,
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'Updated' },
    });

    const second = await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: mutId,
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'Updated' },
    });

    expect(second.status).toBe('DUPLICATE_MUTATION');
    expect(second.version).toBe(first.version);
  });

  it('rejects invalid request with missing fields', async () => {
    const result = await syncDocument({
      documentId: '',
      deviceId: '',
      deviceName: '',
      mutationId: '',
      baseVersion: 0,
      baseClock: {},
      data: null as any,
    });
    expect(result.status).toBe('REJECTED_INVALID');
  });

  it('rejects sync to non-existent document', async () => {
    const result = await syncDocument({
      documentId: 'non-existent-id',
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: {},
      data: { title: 'test' },
    });
    expect(result.status).toBe('REJECTED_INVALID');
  });

  it('handles rapid concurrent syncs safely', async () => {
    const doc = createDocument({ counter: 0 }, 'init', 'Server');

    const promises = Array.from({ length: 10 }, (_, i) =>
      syncDocument({
        documentId: doc.id,
        deviceId: `device-${i}`,
        deviceName: `Device ${i}`,
        mutationId: uuidv4(),
        baseVersion: 1,
        baseClock: { init: 1 },
        data: { counter: i + 1 },
        conflictResolution: 'lww',
      })
    );

    const results = await Promise.all(promises);
    const validStatuses = ['ACCEPTED', 'AUTO_MERGED', 'CONFLICT_RESOLVED_LWW', 'REJECTED_STALE'];
    results.forEach(r => {
      expect(validStatuses).toContain(r.status);
    });

    const finalDoc = getDocument(doc.id)!;
    expect(finalDoc.version).toBeGreaterThan(1);
  });
});

describe('Version History & Time Travel', () => {
  it('tracks revision history', async () => {
    const doc = createDocument({ title: 'v1' }, 'deviceA', 'Phone');

    await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'v2' },
    });

    const history = getDocumentHistory(doc.id);
    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(1);
    expect(history[1].version).toBe(2);
  });

  it('retrieves a specific revision snapshot', async () => {
    const doc = createDocument({ title: 'original' }, 'deviceA', 'Phone');

    await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'modified' },
    });

    const rev1 = getDocumentRevision(doc.id, 1);
    expect(rev1).toBeDefined();
    expect(rev1!.data.title).toBe('original');

    const rev2 = getDocumentRevision(doc.id, 2);
    expect(rev2!.data.title).toBe('modified');
  });

  it('restores document to a previous version', async () => {
    const doc = createDocument({ title: 'v1' }, 'deviceA', 'Phone');

    await syncDocument({
      documentId: doc.id,
      deviceId: 'deviceA',
      deviceName: 'Phone',
      mutationId: uuidv4(),
      baseVersion: 1,
      baseClock: { deviceA: 1 },
      data: { title: 'v2' },
    });

    const result = await restoreDocument(doc.id, 1, 'deviceA', 'Phone');
    expect(result.status).toBe('ACCEPTED');
    expect(result.data.title).toBe('v1');
    expect(result.version).toBe(3);
  });
});
