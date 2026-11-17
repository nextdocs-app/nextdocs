# End-to-end tests

Playwright (Chromium) drives the real web app, API and Yhub realtime server.
Typing goes through BlockNote, sync goes through `@y/y` + Yhub, and persistence
is read back from Postgres. The only simulated parts are failures: a realtime
socket killed mid-session and a 503 document read, injected through the browser.

## Data model

All suites share one seed layer:

- `global-setup.ts` waits for the three services and seeds **two accounts**
  (`e2e/support/config.ts`). On the empty E2E database the first registration
  bootstraps the workspace; the member is then invited through the real
  workspace invite API and registered with the token read from Mailpit. There
  is no test-only backdoor into the database.
- `e2e/support/fixtures.ts` creates a **fresh document per test** through the
  API and deletes it in teardown. The delete is a trash followed by a purge,
  because the API only permanently deletes what is already in the trash; a
  teardown failure is a test failure, so a document cannot silently pile up in
  the database across runs. Tests never depend on each other's content.
- `openSignedIn(browser, account)` gives each browser test its own context,
  logged in through the API so the HttpOnly refresh cookie lands in that
  context's jar. Two contexts for the same account still produce two Yjs
  clients and two awareness states, which is what collaboration needs.

Tests must run one at a time (`workers: 1`): a document is a shared Yhub room,
and the suites are about convergence, not throughput.

## Prerequisites

```bash
npm run e2e:install   # Chromium for Playwright
```

The stack must be running against a **dedicated E2E database**, never the dev
one. The suite deletes documents and bootstraps users.

```bash
# Docker dependencies (names match ./nd dev); Mailpit carries the invite emails
docker start nextdocs-postgres nextdocs-redis nextdocs-mailpit

# One-time database setup; drop + recreate for a clean slate
docker exec nextdocs-postgres psql -U nextdocs -d postgres -c 'CREATE DATABASE nextdocs_e2e;'
docker exec nextdocs-postgres psql -U nextdocs -d postgres -c 'CREATE DATABASE nextdocs_e2e_yhub;'
POSTGRES=postgres://nextdocs:nextdocs@localhost:5433/nextdocs_e2e_yhub \
  node node_modules/@y/hub/bin/init-db.js
```

Start the three services in one terminal:

```bash
export JWT_SECRET=e2e-local-jwt-secret-0123456789abcdef \
  YHUB_SERVICE_TOKEN=e2e-local-service-token-0123456789abcdef \
  OAUTH_TOKEN_ENCRYPTION_KEY_BASE64="$(openssl rand -base64 32)" \
  POSTGRES=postgres://nextdocs:nextdocs@localhost:5433/nextdocs_e2e_yhub \
  SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5433/nextdocs_e2e \
  SPRING_DATASOURCE_USERNAME=nextdocs SPRING_DATASOURCE_PASSWORD=nextdocs \
  API_BASE_URL=http://localhost:8080 CORS_ALLOWED_ORIGINS=http://localhost:3000 \
  NEXT_PUBLIC_API_URL=http://localhost:8080 \
  NEXT_PUBLIC_REALTIME_URL=ws://localhost:1234 \
  SPRING_MAIL_HOST=127.0.0.1 SPRING_MAIL_PORT=1025 \
  SPRING_MAIL_SMTP_STARTTLS=false \
  SPRING_MAIL_SMTP_SSL_CHECK_SERVER_IDENTITY=false \
  APP_WEB_BASE_URL=http://localhost:3000 \
  RATE_LIMIT_AUTH_MAX_REQUESTS=1000

(cd api && ./mvnw spring-boot:run --no-transfer-progress) &
PORT=1234 npm run dev -w realtime &
npm run dev -w web -- -p 3000 &
wait
```

The API refuses to start without `OAUTH_TOKEN_ENCRYPTION_KEY_BASE64`, and it
requires a JWT secret of at least 32 bytes; both services must share the same
`JWT_SECRET` and `YHUB_SERVICE_TOKEN`, or every socket and every content read is
rejected. Mailpit's SMTP port is the invite channel, and `APP_WEB_BASE_URL` is
the link in that email.

`PORT=1234` is explicit because the realtime server defaults to `1234` only when
the variable is unset; a stray `PORT` from another shell silently moves it.
`RATE_LIMIT_AUTH_MAX_REQUESTS` raises the API's login/refresh budget for the
suite, which signs in several times per minute from loopback. Keep the app URLs
on `localhost`: Next's dev server blocks its own dev resources when a page is
loaded from another origin, so `127.0.0.1` would leave the editor unhydrated.

## Run

```bash
npm run e2e                       # headless, one worker
npm run e2e -- --headed           # watch the browser
npm run e2e -- -g "comments"      # single area
npm run e2e -- e2e/tests/editor.spec.ts
```

`global-setup.ts` fails with the missing service and URL when the stack is not
up, instead of letting every test time out.

## CI

The suite is wired in as `ci-e2e.yml` (`E2E / Browser suite`) and is part of
`CI / Required checks`. It runs on pushes to `main`, merge-queue batches, the
nightly schedule, manual dispatches, and on every pull request that touches
`web/**`, `realtime/**`, `api/**`, `e2e/**` or shared root config — a PR that can
change the editor, the socket or the API contract has to pass it before merging.

The job builds the API jar, builds `realtime`, installs Chromium, starts the same
stack against service containers, and runs `npm run e2e`; the local recipe above
is that job's equivalent (see the workflow for the exact env). The three installs
run concurrently, Playwright's browser download is cached, and the dev server's
first-compile routes are warmed before the suite starts, because the suite itself
is only ~90s and the fixed setup would otherwise dominate the job.

## Coverage

| File                    | What it proves                                                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.spec.ts`        | typed content survives reload; the editor paints server content when realtime is down; a 503 content read paints the IndexedDB copy and loses nothing                                                                 |
| `collaboration.spec.ts` | two-client edits, offline edits syncing on reconnect, a hard socket kill mid-edit reconnecting without duplicate content, local-only undo, deletions, late join, reload, presence cursor + name, simultaneous inserts |
| `comments.spec.ts`      | thread anchor/highlight, second-client visibility, COMMENT reply, owner resolve, resolved state on the other client                                                                                                   |
| `permissions.spec.ts`   | VIEW is read-only, EDIT writes reach the owner, an unrelated user gets the restricted screen                                                                                                                          |
| `multitab.spec.ts`      | two tabs of one browser converge, and a comment created in one tab appears in the other's open sidebar                                                                                                                |

BlockNote's own block features (input rules, marks, slash menu, list
conversion) are deliberately not re-tested here; these specs cover the app glue
and the failure modes around it.

Not covered yet: comment edit/delete/reactions, workspace role administration
(ADMIN vs OWNER), public share links, and a realtime server restart (the socket
kill covers a dropped connection, not the process going away).

## Debugging

Traces, video and screenshots are kept only on failure under
`e2e/test-results/` (`npm run e2e -- --trace on` keeps them always). Open a
trace with `npx playwright show-trace <trace.zip>`.
