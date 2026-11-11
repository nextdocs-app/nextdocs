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

| Variable              | Default                                                     | Description                                                            |
| --------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `PORT`                | `1234`                                                      | Server port                                                            |
| `REDIS`               | `redis://localhost:6379`                                    | Yhub stream and task queue                                             |
| `POSTGRES`            | `postgres://nextdocs:nextdocs@localhost:5433/nextdocs_yhub` | Yhub persistence                                                       |
| `API_BASE_URL`        | `http://localhost:8080`                                     | API origin for access checks                                           |
| `JWT_SECRET`          | dev default                                                 | Must match the API; required and ≥ 32 bytes when `NODE_ENV=production` |
| `YHUB_SERVICE_TOKEN`  | dev default                                                 | Shared service secret; required and ≥ 32 bytes in production           |
| `CORS_ORIGIN`         | `http://localhost:3000`                                     | Comma-separated browser origins (`CORS_ALLOWED_ORIGINS` also accepted) |
| `MAX_DOC_SIZE_BYTES`  | `16777216`                                                  | Per-document ceiling; Yhub's 500 MB default is a memory hazard         |
| `SWEEP_INTERVAL_MS`   | `30000`                                                     | Active-room re-authorization interval                                  |
| `MAX_RECHECK_DOCS`    | `5000`                                                      | Upper bound for one batched recheck request                            |
| `RECHECK_CONCURRENCY` | `8`                                                         | Rooms re-authorized in parallel by the sweep and batch handler         |
| `LOG_LEVEL`           | `info`                                                      | `debug`, `info`, `warn`, or `error`                                    |

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

A definitive denial (401/403) closes the socket permanently. Everything else — 404
included — answers 503 so Yhub retries instead of treating the outage as a revocation.
A 404 cannot be a verdict: the API folds a real not-found into `200 allowed: false`, so
it only means this route is unreachable (a base-path error, or a proxy blocking it). The
API answers a bad service header with 503 as well, because a rotated or half-applied
secret is a deployment fault, not a decision about the caller.

The public proxy must block `/api/v1/internal/**`. Those routes are `permitAll` at the
API's filter layer, and the service token is their only gate; exposing them would put
the shared secret in reach of every client. `X-Yhub-Service` is not a browser header, so
a request carrying it only from the realtime service is the intended path.

A 503 is retried with backoff by `y-websocket` on the browser side and re-checked by the
next sweep here. A transient outage never freezes a room: only a 401/403 is permanent.

## Permissions

Yhub is deny-by-default. `src/permissions.ts` lists the endpoints each role may use:

- `VIEW` reads the Y.Doc and awareness. It cannot touch comment anchors.
- `COMMENT` reads the Y.Doc, writes awareness (presence and the comment-refresh ping),
  and may call the `anchor` endpoint. That endpoint is the only Y.Doc mutation a
  commenter can request: the service inserts a mark for a thread the API confirms,
  never a client-supplied update. The endpoint's `d` bit removes a mark only after
  the API reports the thread gone (orphan cleanup).
- `EDIT` / `OWNER` read and write both, and use the same anchor endpoint when the
  editor creates a thread.
- The service identity gets explicit document read/write plus `delete: ['soft','hard']`
  and the org-scoped `recheck` endpoint. There is no wildcard grant: a future Yhub
  endpoint stays closed until it is added deliberately.

## Comment anchors

Threads and replies live in the API, but the BlockNote mark that ties a thread to
a passage is a Yjs format on the `blocknote` fragment. A COMMENT user is read-only
on that fragment, so the browser never inserts the mark itself. It sends the
selection as two Yjs relative positions:

```json
{ "threadId": "<uuid>", "selection": { "anchor": { … }, "head": { … } } }
```

The handler asks the comment API for that thread (`GET
/api/v1/documents/{docid}/threads/{threadId}`) with the caller's own credential.
A 200 proves the thread belongs to this document and that the caller may comment
on it; a 404/401/403 is permanent, and anything else answers 503 so the client
can retry. Only then does `agentTask` hydrate the room, resolve the client's
relative positions against the current CRDT, and apply the `comment` format.
Relative positions survive edits made between selection and hydration; a range
that no longer exists is rejected with 409 instead of being applied to the wrong
text. Repeating the request is safe: formatting an already-marked range is a
no-op.

`DELETE ...?threadId=<uuid>` removes every format that references the thread.
It is deliberately allowed for COMMENT users as well: the handler first requires
the API to report the thread gone, so it can only clear an orphan (for example
after the author deletes the thread's last comment), never strip a live thread's
highlight.

`agentTask` forwards the update through Yhub's stream, so connected clients see
the mark without a second client-generated Yjs update. A 200 means the handler
ran and the update was queued; it does not by itself prove durable compaction,
which is why the operation is idempotent and safe to retry.

Anchor requests are limited to 20 mutations per caller and document per minute
per realtime instance; excess requests answer 429. A share-link guest has no
identity, so every guest on a document shares one budget. A body over 16 KiB is
rejected with 413, but that cap bounds what the handler parses, not what the
process holds: Yhub buffers a request body before any handler runs, so an
oversized body is still a reverse proxy's job to refuse. Removing an anchor from
an empty document succeeds with `removed: 0` so cleanup remains idempotent after
all content is deleted.

## Endpoints

| Method   | Path                                         | Scope    | Purpose                                             |
| -------- | -------------------------------------------- | -------- | --------------------------------------------------- |
| `GET`    | `/api/ping/v1`                               | global   | Liveness: answers without touching a store          |
| `GET`    | `/api/health/v1`                             | global   | Readiness: Redis + Postgres, two-second budget each |
| `POST`   | `/api/recheck/v1/nextdocs`                   | org      | Batched re-authorization (service only)             |
| `POST`   | `/api/anchor/v1/nextdocs/{docid}`            | document | Insert a comment mark (COMMENT+)                    |
| `DELETE` | `/api/anchor/v1/nextdocs/{docid}?threadId=…` | document | Remove an orphaned comment mark (after deletion)    |
| `PATCH`  | `/api/ydoc/v1/nextdocs/{docid}`              | document | Seed a new document                                 |
| `GET`    | `/api/ydoc/v1/nextdocs/{docid}`              | document | Read the persisted update                           |
| `DELETE` | `/api/ydoc/v1/nextdocs/{docid}?hard=true`    | document | Purge content                                       |
| `WS`     | `/api/ws/v1/nextdocs/{docid}`                | document | Collaboration stream                                |

`POST /api/recheck/v1/nextdocs` takes `{"docids": ["<uuid>", …], "users": ["<uuid>", …]}`
(`users` optional). Access is inherited, so the API expands a page change to its subtree
and sends one request instead of one per page.

Yhub drops a sync write from a connection without `ydoc` write permission, and it does
so without a log line (the old in-process gate logged at WARN). A read-only client that
writes anyway is therefore silent here; watch the API-side socket refusals and the
sweep, and treat a client report of a disappearing edit as the signal. The integration
suite asserts the drop against the stored document, because a same-process peer would
otherwise see the write over `BroadcastChannel` and make the gate look broken.

Yjs merges concurrent writes to the metadata map by client ID, not by wall-clock time.
Two offline copies that both change a title therefore pick one deterministically, not
the most recent one. The offline queue is the mechanism that keeps a queued title from
being overwritten silently: it replays through the normal PATCH path, and the pending
marker tracks how many edits are still in flight.

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

## Content ownership and purge

Yhub owns document content; the API does not mirror it into Postgres. First paint reads
the room on demand through the API's content endpoint, and a transient read answers
`503` so the browser can fall back to its IndexedDB copy. A room that has never been
written is empty content, not an error.

Hard deletes go through `yhub_purge_outbox` and are retried with backoff, so a Yhub
outage delays deletion but cannot strand content.

When a compaction finds new content, the worker calls
`POST {API_BASE_URL}/api/v1/internal/realtime/content-updated?documentId=<uuid>` with
`X-Yhub-Service`. The API moves `updated_at` only; content writes never touch that
column, because it is the sidebar sort key.

## Shutdown

`SIGTERM`/`SIGINT` drain the server through `createYHub`'s `destroy({ drainMs })` handle:
a 5 s drain, then a forced exit 3 s later. Compose sets `stop_grace_period: 12s`, so
Docker's SIGKILL lands after the forced exit instead of racing it. The Dockerfile
`exec`s node so the signal reaches PID 1: a deploy that dropped sockets without a close
frame looked exactly like a network fault to every client.

## Development

```bash
npm run dev  -w realtime
npm run test -w realtime
npm run lint -w realtime
```

`npm run test:integration -w realtime` runs the suite that needs real stores. It expects
Postgres and Redis (defaults to `localhost:5433` and `localhost:6379`, overridable with
`POSTGRES` and `REDIS`) and a built `dist/` (`npm run build -w realtime`). The global
setup creates the Yhub database and applies its schema. Set `DOCKER_TESTS=1` with
`REALTIME_IMAGE` pointing at a built image to include the PID 1 and schema-bootstrap
checks; CI builds the image before that run.

Realtime is ESM (`"type": "module"`, `moduleResolution: NodeNext`): relative imports inside
`src/` use the `.js` extension even though the files are `.ts`.
