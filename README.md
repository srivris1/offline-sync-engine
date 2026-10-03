# Offline Sync Engine

A distributed synchronization backend that handles concurrent modifications from multiple devices using **Vector Clocks** for causal ordering and **Git-style 3-way field-level merging** for intelligent conflict resolution.

![Node.js](https://img.shields.io/badge/Node.js-22-green) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue) ![Express](https://img.shields.io/badge/Express-4.21-lightgrey) ![Tests](https://img.shields.io/badge/Tests-38%20passed-brightgreen)

## Live Demo

**[→ API Root](https://offline-sync-engine.vercel.app)** | **[→ Swagger Docs](https://offline-sync-engine.vercel.app/docs)** | **[→ Interactive Simulator](https://offline-sync-engine.vercel.app/simulator)**

## Problem Statement

People use applications across multiple devices. A user may edit a document on their phone while offline, make different edits on their laptop, and later connect both. What happens when the server receives changes from different versions of the same data?

This engine provides clear, consistent, and predictable rules for synchronization — detecting true conflicts, auto-merging safe changes, and never silently overwriting data.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Client Device A                        │
│  data: {title: "From A", status: "draft"}                │
│  baseClock: {A:1}, baseVersion: 1                        │
└────────────────────────┬─────────────────────────────────┘
                         │ POST /api/v1/sync
                         ▼
┌──────────────────────────────────────────────────────────┐
│                  Sync Engine (Server)                     │
│                                                          │
│  1. Validate request (fields, mutation ID)                │
│  2. Check mutation cache (idempotency)                    │
│  3. Acquire per-document mutex lock                       │
│  4. Compare Vector Clocks:                                │
│     ┌─ AFTER  → Fast-forward accept                      │
│     ├─ EQUAL  → Fast-forward accept                      │
│     ├─ BEFORE → Reject as stale                          │
│     └─ CONCURRENT → 3-way field merge                    │
│  5. Three-Way Field-Level Merge:                          │
│     ┌─ Find common ancestor revision                     │
│     ├─ Compare each field: ancestor vs current vs incoming│
│     ├─ Auto-merge non-conflicting fields                 │
│     └─ Flag true conflicts (same field, different values) │
│  6. Conflict Resolution:                                  │
│     ├─ Auto-merged → ACCEPTED                            │
│     ├─ LWW requested → Apply last-write-wins             │
│     └─ Manual → Return 409 with 3-way diff               │
│  7. Update Vector Clock, increment version                │
│  8. Store revision in history, release lock               │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                    Client Device B                        │
│  data: {title: "Hello", status: "published"}             │
│  baseClock: {A:1}, baseVersion: 1                        │
└──────────────────────────────────────────────────────────┘
```

## Core Concepts

### Vector Clocks
Each document maintains a vector clock `{deviceA: 3, deviceB: 1}` that tracks how many mutations each device has contributed. This enables precise causal ordering without relying on system timestamps (which are unreliable across devices).

| Comparison | Meaning |
|-----------|---------|
| `BEFORE` | Incoming change happened before server state |
| `AFTER` | Incoming change is a direct successor (fast-forward) |
| `EQUAL` | Same state, no-op |
| `CONCURRENT` | Independent branches — requires merge |

### Three-Way Field-Level Merge
When concurrent changes are detected, the engine finds the **common ancestor** revision and performs per-field comparison:

| Ancestor | Server (Current) | Incoming | Result |
|----------|-----------------|----------|--------|
| "Hello" | "Hello" | "Updated" | ✅ Auto-merge incoming |
| "Hello" | "Changed" | "Hello" | ✅ Keep current |
| "Hello" | "Changed" | "Changed" | ✅ Same change, no conflict |
| "Hello" | "Value A" | "Value B" | ⚠️ True conflict |

### Conflict Resolution Strategies
1. **Auto-Merge** (default): Non-conflicting field changes are merged automatically
2. **Last-Write-Wins (LWW)**: Client requests `conflictResolution: "lww"` to force incoming values
3. **Manual Resolution**: Server returns `409` with full 3-way diff for client-side resolution

## API Reference

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/documents` | List all documents |
| `POST` | `/api/v1/documents` | Create a new document |
| `GET` | `/api/v1/documents/:id` | Get document by ID |
| `DELETE` | `/api/v1/documents/:id` | Soft-delete (tombstone) |

### Synchronization

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/sync` | Submit a device change for sync |

**Sync Request Body:**
```json
{
  "documentId": "uuid",
  "deviceId": "device-phone",
  "deviceName": "Pixel 9",
  "mutationId": "unique-uuid-per-mutation",
  "baseVersion": 1,
  "baseClock": {"device-phone": 1},
  "data": {"title": "Updated Title", "status": "published"},
  "conflictResolution": "lww"
}
```

**Possible Sync Statuses:**
| Status | HTTP | Meaning |
|--------|------|---------|
| `ACCEPTED` | 200 | Direct fast-forward update accepted |
| `AUTO_MERGED` | 200 | Concurrent but non-conflicting, auto-merged |
| `CONFLICT_RESOLVED_LWW` | 200 | Conflict resolved via Last-Write-Wins |
| `CONFLICT_REQUIRES_RESOLUTION` | 409 | True conflict, client must resolve |
| `REJECTED_STALE` | 409 | Update too far behind, fetch latest first |
| `REJECTED_INVALID` | 400 | Missing/invalid fields |
| `DUPLICATE_MUTATION` | 200 | Idempotent replay of cached mutation |

### Version History & Time Travel

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/documents/:id/history` | List all revisions |
| `GET` | `/api/v1/documents/:id/revisions/:v` | Inspect snapshot at version v |
| `POST` | `/api/v1/documents/:id/restore/:v` | Rollback to version v |

## Edge Cases Handled

- **Race conditions**: Per-document atomic mutex locks prevent concurrent corruption
- **Out-of-order delivery**: Vector clock comparison detects causal ordering regardless of arrival time
- **Duplicate mutations**: 24-hour mutation ID cache ensures idempotent replays
- **Stale updates**: Changes from far-behind versions are rejected with clear error messages
- **Tombstone propagation**: Soft-deleted documents reject further syncs without resurrection
- **Rapid concurrent syncs**: 10+ simultaneous device syncs resolve deterministically

## Interactive Simulator

Navigate to `/simulator` to access the **Multi-Device Visual Simulator**:

1. Create a document with custom JSON fields
2. Two simulated devices appear: **Phone** and **Laptop**
3. Toggle devices **Offline/Online**
4. Edit different fields on each device
5. Hit **Sync** and watch the event log show ACCEPTED, AUTO_MERGED, or CONFLICT results
6. Inspect Vector Clock advancement in real-time

## Test Suite

```bash
npm test
```

```
✓ tests/vector-clock.test.ts (14 tests)
✓ tests/merger.test.ts       (11 tests)
✓ tests/sync.test.ts         (13 tests)

Test Files  3 passed (3)
     Tests  38 passed (38)
```

**Test coverage includes:**
- Vector clock creation, increment, merge, all 4 causal orderings
- 3-way merge: no-change, auto-merge, true conflict, mixed, field addition/deletion
- Sync: fast-forward, auto-merge, conflict (manual + LWW), stale rejection, idempotency, concurrent races, history tracking, time travel, rollback

## Getting Started

```bash
git clone https://github.com/srivris1/offline-sync-engine.git
cd offline-sync-engine
npm install
npm run dev
```

Server starts at `http://localhost:3001`

| URL | Description |
|-----|-------------|
| `http://localhost:3001` | API root with endpoint listing |
| `http://localhost:3001/docs` | Swagger UI (interactive API docs) |
| `http://localhost:3001/simulator` | Multi-device visual simulator |
| `http://localhost:3001/api/health` | Health check |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 |
| Language | TypeScript 5.7 |
| Framework | Express 4.21 |
| Causality | Vector Clocks |
| Merge | 3-Way Field-Level Semantic Merge |
| Testing | Vitest |
| API Docs | Swagger UI + OpenAPI 3.0 |
| Deployment | Vercel Serverless |

## Design Decisions

**Why Vector Clocks over timestamps?**
System clocks across devices can drift by seconds or minutes. A phone in airplane mode has no NTP sync. Vector Clocks track logical causality — "did this change know about that change?" — without any timestamp dependency.

**Why 3-way merge instead of Last-Write-Wins?**
LWW silently discards valid data. If Device A changes `title` and Device B changes `status`, LWW would pick one device's entire payload and lose the other's. 3-way merge preserves both changes by comparing field-by-field against their common ancestor.

**Why per-document mutex locks?**
Without locks, two concurrent sync requests for the same document could read-then-write in interleaved order, corrupting state. The mutex ensures serial processing per document while allowing parallel processing across different documents.

**Why a mutation ID cache?**
Network retries are common on flaky connections. If a device sends a sync request, loses connection during the response, and retries, the server recognizes the duplicate `mutationId` and returns the cached result — preventing double-application of the same change.
