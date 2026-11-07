# NextDocs Realtime Server

Yjs collaboration server for NextDocs, built on [Yhub](https://github.com/yjs/yhub) 0.10.
The API owns identities and permissions; this service owns the CRDT stream and enforces
the permissions the API reports.

## Setup

Run commands from the repository root so npm workspaces use the single root lockfile.

```bash
npm ci
./nd dev            # starts Postgres, Redis, API, web and realtime
```

Yhub stores its document stream in a **separate Postgres database** (`nextdocs_yhub`).
Its schema is created by the only DDL path in the package:

```bash
POSTGRES=postgres://nextdocs:nextdocs@localhost:5433/nextdocs_yhub \
  node node_modules/@y/hub/bin/init-db.js
```

`./nd dev` and the Docker image run this for you. It is idempotent.

## Configuration

| Variable                | Default                                                     | Description                                                            |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `PORT`                  | `1234`                                                      | Server port                                                            |
| `REDIS`                 | `redis://localhost:6379`                                    | Yhub stream and task queue                                             |
| `POSTGRES`              | `postgres://nextdocs:nextdocs@localhost:5433/nextdocs_yhub` | Yhub persistence                                                       |
| `API_BASE_URL`          | `http://localhost:8080`                                     | API origin for access checks                                           |
| `JWT_SECRET`            | dev default                                                 | Must match the API; required and ≥ 32 bytes when `NODE_ENV=production` |
| `YHUB_SERVICE_TOKEN`    | dev default                                                 | Shared service secret; required and ≥ 32 bytes in production           |
| `CORS_ORIGIN`           | `http://localhost:3000`                                     | Comma-separated browser origins (`CORS_ALLOWED_ORIGINS` also accepted) |
| `MAX_DOC_SIZE_BYTES`    | `16777216`                                                  | Per-document ceiling; Yhub's 500 MB default is a memory hazard         |
| `SWEEP_INTERVAL_MS`     | `30000`                                                     | Active-room re-authorization interval                                  |
| `ACTIVE_ROOM_WINDOW_MS` | `300000`                                                    | How long a room counts as active for the sweep                         |
| `MAX_RECHECK_DOCS`      | `5000`                                                      | Upper bound for one batched recheck request                            |

In production the process refuses to start with a missing, published or short secret.
A server that boots with a known secret either accepts forged tokens or rejects every
real one, and both failures look healthy from the outside.

## Authentication

The browser presents its API access token as `?token=` or `Authorization: Bearer …`.
The service identity is accepted **only** from `Authorization`: the query string is part
of a URL, so treating it as the service credential would make an admin session reachable
from a link.

Every websocket upgrade and every recheck resolves access through:

```
GET {API_BASE_URL}/api/v1/internal/realtime/access?documentId=<uuid>
X-Yhub-Service: <YHUB_SERVICE_TOKEN>
Authorization: Bearer <user token>   # omitted for anonymous share links
```

A definitive denial (401/403/404) closes the socket permanently. A transient backend
failure answers 503 so Yhub retries instead of treating the outage as a revocation.

## Permissions

Yhub is deny-by-default. `src/permissions.ts` lists the endpoints each role may use:

- `VIEW` reads the Y.Doc and awareness.
- `COMMENT` reads the Y.Doc, writes awareness (presence and the comment-refresh ping).
- `EDIT` / `OWNER` read and write both.
- The service identity gets explicit document read/write plus `delete: ['soft','hard']`
  and the org-scoped `updated`/`recheck` endpoints. There is no wildcard grant: a future
  Yhub endpoint stays closed until it is added deliberately.

## Endpoints

| Method   | Path                                      | Scope    | Purpose                                             |
| -------- | ----------------------------------------- | -------- | --------------------------------------------------- |
| `GET`    | `/api/ping/v1`                            | global   | Liveness: answers without touching a store          |
| `GET`    | `/api/health/v1`                          | global   | Readiness: Redis + Postgres, two-second budget each |
| `GET`    | `/api/updated/v1/nextdocs`                | org      | Projection cursor listing (service only)            |
| `POST`   | `/api/recheck/v1/nextdocs`                | org      | Batched re-authorization (service only)             |
| `PATCH`  | `/api/ydoc/v1/nextdocs/{docid}`           | document | Seed a new document                                 |
| `GET`    | `/api/ydoc/v1/nextdocs/{docid}`           | document | Read the persisted update                           |
| `DELETE` | `/api/ydoc/v1/nextdocs/{docid}?hard=true` | document | Purge content                                       |
| `WS`     | `/api/ws/v1/nextdocs/{docid}`             | document | Collaboration stream                                |

`POST /api/recheck/v1/nextdocs` takes `{"docids": ["<uuid>", …], "users": ["<uuid>", …]}`
(`users` optional). Access is inherited, so the API expands a page change to its subtree
and sends one request instead of one per page.

## Probes

Two questions, two routes, and they are not interchangeable:

- `GET /api/ping/v1` — **liveness**. It answers without touching Redis or Postgres.
  Point liveness here: a store blip must never restart a process that is serving
  healthy sockets.
- `GET /api/health/v1` — **readiness**. The two stores this service cannot serve a
  document without, asked in parallel, each with a two second budget. `503` when
  either is unreachable, and the body names the store and never the error — the
  route is public, and a database client will put its connection string in the
  message it raises. The compose healthcheck uses this one.

## Revocation

Access is inherited, and the API publishes an event after every change that can move the
effective level: grants, settings, moves, trash, restore, space archive/restore/member
changes, and purge. The notifier expands the scope and calls the batched recheck.

A 30 s sweep re-authorizes every room this instance is serving. It is the safety net for
changes that cannot be expanded cheaply (workspace membership, account changes) and for a
missed event. Each replica sweeps only its own rooms, so no shared state is required.

## Projection and purge

The API reads `/api/updated/v1/nextdocs` with a leased singleton cursor and writes the
snapshot into `documents.yjs_state` without touching `updated_at`. A transient read or a
page that exceeds its time budget stops the page without advancing the cursor, so the
next run retries the same position instead of skipping content. Hard deletes go through
`yhub_purge_outbox` and are retried with backoff, so a Yhub outage delays deletion but
cannot strand content.

When a compaction finds new content, the worker calls
`POST {API_BASE_URL}/api/v1/internal/realtime/content-updated?documentId=<uuid>` with
`X-Yhub-Service`. The API moves `updated_at` only; the projection never touches that
column, because it is the sidebar sort key and a ten-second replica would otherwise
reorder the sidebar constantly.

## Development

```bash
npm run dev  -w realtime
npm run test -w realtime
npm run lint -w realtime
```

Realtime is ESM (`"type": "module"`, `moduleResolution: NodeNext`): relative imports inside
`src/` use the `.js` extension even though the files are `.ts`.
