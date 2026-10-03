# Offline Sync Engine

A backend service that handles concurrent document edits from multiple devices. When two devices modify the same document while one is offline, this engine figures out which changes can be merged automatically and which ones actually conflict. Built for the GDG on Campus SRM Backend Technical Task.

## The problem

Imagine you edit a shared note on your phone during a flight, and your colleague edits the same note on their laptop at the same time. When both devices reconnect, the server receives two different versions of the same document. Simply picking the "latest" one means losing someone's work. This engine solves that.

## How it works

### Vector Clocks for causality

Instead of relying on wall-clock timestamps (which drift between devices), each document carries a **vector clock** — a map of `{deviceId: counter}` that tracks how many changes each device has made. This lets the server determine whether two changes are sequential (one happened after the other) or truly concurrent (neither knew about the other).

```
Device A:  {A: 1}  →  {A: 2}
Device B:  {A: 1, B: 1}   ← concurrent with A:2
```

When the server compares `{A: 2}` with `{A: 1, B: 1}`, it sees that A is ahead on its own counter but behind on B's — that's a concurrent modification.

### Three-way field-level merge

When concurrent changes are detected, the engine doesn't just pick one. It finds the **common ancestor** (the version both devices started from) and compares each field individually:

- If only Device A changed `title` and only Device B changed `status`, both changes are merged automatically. No conflict.
- If both devices changed `title` to different values, that's a true conflict. The server can either apply Last-Write-Wins (if the client requests it) or return the conflict details for manual resolution.

This is the same approach git uses for merge commits, but applied to JSON document fields.

### Idempotent mutations

Network retries are common on flaky connections. If a device sends a sync request, loses connection during the response, and retries the same request, the server recognizes the duplicate `mutationId` and returns the cached result instead of applying the change twice.

## Tech stack

- **Node.js + Express** — straightforward HTTP server. Express handles routing, CORS, and JSON parsing. The API is RESTful with proper HTTP status codes (200 for success, 409 for conflicts, 400 for invalid input).

- **TypeScript** — the sync logic involves complex state transitions (ACCEPTED → AUTO_MERGED → CONFLICT_REQUIRES_RESOLUTION). TypeScript's union types make it impossible to accidentally return an invalid status or forget to handle a case.

- **TSX** for development — runs TypeScript directly without a compile step, with file watching for hot reload.

- **Vitest** for testing — 38 tests covering vector clock math, three-way merge logic, and full sync integration scenarios including race conditions with 10 concurrent devices.

- **In-memory storage** — documents are stored in a Map with per-document mutex locks. This is deliberate — the task is about sync algorithms, not database integration. The locking mechanism prevents race conditions when multiple sync requests arrive for the same document simultaneously.

- **Swagger UI** at `/docs` — auto-generated from an OpenAPI 3.0 spec embedded in the server. You can test every endpoint directly from the browser.

## API overview

| Endpoint | What it does |
|----------|-------------|
| `POST /api/v1/documents` | Create a new document |
| `GET /api/v1/documents` | List all documents |
| `GET /api/v1/documents/:id` | Get a single document |
| `DELETE /api/v1/documents/:id` | Soft-delete (tombstone) |
| `POST /api/v1/sync` | Submit a change from a device |
| `GET /api/v1/documents/:id/history` | Version history |
| `GET /api/v1/documents/:id/revisions/:v` | Inspect a specific version |
| `POST /api/v1/documents/:id/restore/:v` | Rollback to a previous version |

### Sync response statuses

The sync endpoint returns one of these statuses so the client knows exactly what happened:

- **ACCEPTED** — direct update, no conflicts
- **AUTO_MERGED** — concurrent changes on different fields, merged cleanly
- **CONFLICT_RESOLVED_LWW** — conflict existed, resolved by Last-Write-Wins
- **CONFLICT_REQUIRES_RESOLUTION** — true conflict, client needs to decide
- **REJECTED_STALE** — device is too far behind, needs to fetch latest first
- **DUPLICATE_MUTATION** — idempotent replay of a previous request

## Interactive simulator

Navigate to `/simulator` to test sync scenarios visually. It simulates two devices (Phone and Laptop) editing the same document. You can:

1. Create a document with custom fields
2. Toggle each device offline/online
3. Edit different fields on each device
4. Hit "Sync" and watch the event log show what happened
5. See vector clocks advance in real time

This is useful for understanding how the engine handles different conflict scenarios.

## Project structure

```
src/
├── core/
│   ├── vector-clock.ts     -- clock creation, increment, merge, causal comparison
│   └── merger.ts           -- 3-way field-level merge + LWW fallback
├── store/
│   └── document-store.ts   -- document CRUD, sync logic, mutex locks, mutation cache
├── api/
│   └── routes.ts           -- Express routes
├── simulator/
│   └── index.html          -- interactive multi-device testing UI
└── server.ts               -- Express setup, Swagger, health check

tests/
├── vector-clock.test.ts    -- 14 tests
├── merger.test.ts          -- 11 tests
└── sync.test.ts            -- 13 tests (including 10-device race condition)
```

## Running locally

```
git clone https://github.com/srivris1/offline-sync-engine.git
cd offline-sync-engine
npm install
npm run dev
```

Server starts at `http://localhost:3001`. API docs at `/docs`, simulator at `/simulator`.

## Running tests

```
npm test
```

All 38 tests should pass in under 2 seconds.
