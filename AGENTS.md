# AGENTS.md

NextDocs: block-based (BlockNote) wiki/docs platform. Three services: Next.js web (`web/`), Yjs WebSocket server (`realtime/`), Spring Boot API (`api/`) + PostgreSQL.

Ports: web `3000`, API `8080`, realtime `1234`.

## Layout decisions that are easy to misread

- npm workspaces are only `web` and `realtime`, orchestrated from the root by Turborepo 2. `api/` is a Maven module and **not** an npm workspace.
- Exactly one lockfile: the root `package-lock.json`. `web/package-lock.json` / `realtime/package-lock.json` are rejected by `npm run check:lockfiles`, by `./nd`, and by CI. Add JS deps from the repo root, e.g. `npm install <pkg> -w web`.
- `web/types/document.types.ts` imports block types from `../realtime/src/types/blocks.ts` through the alias `@/../../realtime/src/types/blocks`; `web/Dockerfile` copies `realtime/src/types` before building web. Block-type changes affect both services.
- `realtime/` is ESM (`"type": "module"`, `moduleResolution: NodeNext`): relative imports inside `src/` must use the `.js` extension even though the files are `.ts` (`import config from './config.js'`).

## Entrypoints

- **web** — App Router under `web/app` (`/` and `/doc/[id]`); shell is `components/AppShell.tsx`, editor is `components/editor` (BlockNote, loaded client-only). Redux Toolkit slices in `stores/`, API/IndexedDB access in `services/`, Yjs + offline glue in `lib/` and `hooks/`. Alias `@/*` → `web/*`.
- **realtime** — `src/main.ts` → `src/server.ts`. Rooms are document ids. Token comes from `?token=` or the `Authorization` header; access is re-checked against `GET {API_BASE_URL}/api/v1/documents/{id}/access-check`. `GET /health`, `GET /metrics`.
- **api** — package `com.nextdocs.api` with parallel `auth/` and `document/` packages (controller / service / repository / dto / entity), `/api/v1/...`, uniform response envelope `{success, data, error, message, timestamp}` (`common/response/ApiResponse`), nulls omitted from JSON.

## Commands

All from the repo root:

```bash
./nd dev              # api + web + realtime; requires Docker (auto-starts/stops the postgres container)
./nd dev web          # one service (postgres is still started even for web/realtime only)
./nd test [service]   # api | web | realtime
./nd lint web --fix   # eslint --fix for web/realtime (spotless:check for api)
./nd format --fix     # prettier for web/realtime + spotless:apply for api
./nd db               # psql into the container (postgres is published on host port 5433)
npm run verify        # git-hook checks (format/lint/test) against the branch diff
```

`./nd --help` prints usage but also "Unknown command" and exits 1.

Single test / focused run (args after `--` are forwarded to Jest):

```bash
npx turbo run test --filter=web -- tests/unit/lib/yjs.util.test.ts
npx turbo run test --filter=realtime -- tests/unit/config.test.ts
cd api && ./mvnw test -Dtest=ApiExceptionTest        # single Java test class
```

- Use Node 24.14.1 (`nvm use`); `engines` require `>=24.14.1`. A host default of Node 20 still runs tests but is below the required version.
- `realtime` tests are ESM ts-jest and its `test` script sets `NODE_OPTIONS=--experimental-vm-modules`; run them via `npm`/`turbo`, never bare `jest`.
- No `.env` is needed for local dev: web/realtime fall back to localhost URLs, the API defaults to postgres on `localhost:5433`. The root `.env.example` is for containerized/API runs only. `./nd dev` generates ephemeral `JWT_SECRET` / OAuth keys per session, so sessions do not survive a restart unless you export them.

## CI and verification gotchas

- CI is per service and path-filtered (`web/**`, `realtime/**`, `api/**`); each runs format/lint → test → build, and the `api` and `realtime` workflows additionally build a Docker image. Root config files (`turbo.json`, `tsconfig.base.json`, `.prettierrc`, `package-lock.json`) trigger the JS workflows only.
- Java formatting is **not** checked by `mvn test`: `spotless:check` is bound to the `verify` phase, and CI runs it in a separate lint job. Run `./nd lint api` (or `./nd format api --fix`, Spotless + palantirJavaFormat) before pushing; do not hand-format Java.
- Flyway migrations in `api/src/main/resources/db/migration` are never applied by tests (test properties disable Flyway; `ddl-auto` is `none` locally / `validate` in Docker). Exercise new SQL against the `./nd` Postgres container. Hibernate must not manage the schema — every schema change needs a migration file.
- Migration numbering: files exist for `V1, V2, V4…V11`; `V3__add_source_local_id_for_documents.sql` was deleted on purpose and must stay unused (recreating it is out-of-order for databases that already applied later versions). Next file is `V12__name.sql`.
- API tests run on H2 locally, while CI starts a Postgres service with `SPRING_DATASOURCE_*` overrides for the same suite — avoid H2-only SQL in repositories.
- Web Jest runs through `next/jest`; if it logs `jest-haste-map: Haste module naming collision: web`, a standalone build left `web/.next/standalone` behind. Tests still pass.

## Conventions

- Git hooks live in `.husky/*` (thin sh wrappers around `scripts/hooks.js`) and are installed by `npm ci` through the root `prepare` script: `pre-commit` runs lint-staged (Prettier + ESLint `--fix` per workspace, Spotless per staged Java file), `commit-msg` validates the subject. `npm run verify` runs the format/lint/test checks manually against the branch diff (tests otherwise run in CI); bypass a hook with `SKIP_HOOKS=1`, `SKIP_HOOKS=<hook>`, `HUSKY=0`, or `--no-verify`.
- lint-staged leaves its `lint-staged automatic backup` stash behind when it cannot restore the tree (the hook prints recovery commands). `api/mvnw.cmd` is permanently reported as modified here (CRLF vs `.gitattributes eol=crlf`), which is what triggers it — do not commit that normalization unless asked.
- Commit subjects use an area prefix: `editor:`, `sidebar:`, `layout:`, `api:`, `readme:`, `build(deps):` (enforced by the `commit-msg` hook; max 100 characters, blank line before the body).
- Icons are hand-written SVG components in `web/icons` (`IconBase` + barrel export); there is no icon library dependency — add a component rather than a package.

### Commits

Every line of a commit message is ≤ 72 characters; the subject follows `<area>: <description>.` and stays under 72 chars too. **Never say anything the diff already shows.** No "added tests", "tests pass", or other narration of the change — write for a reviewer skimming `git log`, not for the diff. A line that is obvious from the diff has no place in the message; say _why_ instead: the problem being fixed, the constraint, the trade-off (for example `sidebar: Silence background root syncs and cut tree re-renders.` with a body explaining `fetchRootNodesThunk pulsed isRootLoading on every meta sync`). If the subject alone tells the whole story, omit the body.

Keep commits coherent for reviewers: one logical change per commit, and every commit that needs tests carries its tests in the same commit. Splitting behavior and its tests across commits is a review smell. Title & body structure of the commit should be: area-prefixed sentence-style subject ending with a period, blank line, then a short body that explains why — not what the diff shows.
