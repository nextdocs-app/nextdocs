<p align="center">
  <a href="https://github.com/santhoshh-kumar/nextdocs">
      <img width="100%" alt="NextDocs" src="https://github.com/user-attachments/assets/3dcdd4e8-9e87-4a27-b729-70f50fd819db" />
  </a>
</p>

<h3 align="center">
  <em>An open-source, block-based wiki and documentation platform for everyone.</em>
</h3>

<p align="center">
  <a href="https://github.com/santhoshh-kumar/nextdocs/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-AGPLv3-3B82F6?style=flat-square" alt="License"></a> 
  <a href="https://www.blocknotejs.org/"><img src="https://img.shields.io/badge/Powered--by-BlockNote-7C3AED?style=flat-square" alt="BlockNote"></a> 
  <a href="https://yjs.dev/"><img src="https://img.shields.io/badge/Collaboration-Yjs-F59E0B?style=flat-square" alt="Yjs"></a>
  <a href="https://github.com/santhoshh-kumar/nextdocs/releases"><img src="https://img.shields.io/badge/Release-Pre--alpha-orange?style=flat-square" alt="Release Status"></a>
</p>

## Overview

- **Block-based editing** — text, tables, media, code and much more.
- **Real-time collaboration** — live cursors and merging.
- **Hierarchical documents** — drag-drop, breadcrumbs, sidebar.
- **Sharing & access** — invites, links with role permissions.
- **Threaded comments** — synced live, resolvable.
- **Trash & recovery** — restore, auto-purge after thirty days.
- **Offline-first** — edit/create even when offline, auto-sync.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 26.13.1 (LTS)
- [Java](https://openjdk.org/) 21
- [Docker](https://www.docker.com/) (for PostgreSQL)
- [pnpm](https://pnpm.io/) 12.21.0 (pinned in `package.json`; run `corepack enable` once, or install it with `npm install -g pnpm@12.21.0`)

### Quick Start

Use Node.js version 26.13.1 (LTS):

```bash
nvm use
```

The fastest way to get NextDocs running locally:

```bash
# Build all services
./nd build

# Start all services — API, web, realtime server, and PostgreSQL
./nd dev
```

That's it. The `./nd` CLI auto-starts a PostgreSQL container, generates ephemeral dev keys if needed, and launches all services with hot-reload.

| Service            | Default URL           |
| ------------------ | --------------------- |
| Web app            | http://localhost:3000 |
| API                | http://localhost:8080 |
| Realtime WebSocket | ws://localhost:1234   |

The defaults belong to the first worktree that starts. Every additional git worktree
gets free ports, its own databases and its own Yhub Redis prefix, so several stacks
can run at once — run `./nd status` to see them and `./nd urls` for this worktree.

For agent or scripted use, `./nd up` starts the full stack detached, writes logs to
`.nd/logs/`, waits until the API, web and realtime URLs answer, and returns. `./nd logs`
reads those logs and `./nd stop` shuts the stack down without touching the shared
containers. Add `--json` to `up`, `status`, `urls`, `logs` or `stop` for one
machine-readable document on stdout; progress and banners go to stderr.

Each start replaces its service's log, so restarts do not accumulate files. There is no
size cap inside one session: the child writes straight to the log's file descriptor, so
renaming it cannot rotate it. A stack left running for days therefore keeps growing its
current logs; `./nd logs --clear` (after `./nd stop`) removes them.

`dev`, `up` and `db reset` claim the worktree while they provision or drop it, so a
reset cannot drop databases under a start that is already in progress.

### Development Commands

Use the `./nd` CLI for all development tasks:

```bash
./nd dev              # Start all services (auto-manages PostgreSQL)
./nd dev api          # Start only the API
./nd dev web          # Start only the web frontend

./nd up               # Full stack detached; returns when all services answer
./nd logs api         # Recent logs from the detached stack (-n N)
./nd logs --clear     # Remove this worktree's logs once the stack is stopped
./nd stop             # Stop this worktree's stack

./nd test             # Run all tests
./nd test api         # Run API tests only

./nd lint             # Lint all code
./nd lint web --fix   # Lint + auto-fix frontend

./nd format --fix     # Format all code (Prettier + Spotless)
./nd build            # Build all packages

./nd db               # Open a psql shell to this worktree's database
./nd status           # Ports and databases of every worktree, plus container health
./nd urls             # This worktree's URLs (--env for sourceable exports)
./nd down             # Alias of ./nd stop (--infra also stops containers)
./nd --help           # See all available commands
```

> [!TIP]
> If `./nd` doesn't have permission to execute, run `chmod +x nd` first. On Windows, use `nd.cmd` instead. The `--json` commands are the portable machine interface; `.nd/instance.env` uses POSIX shell syntax.

### Manual Setup

If you prefer to run services manually without the `./nd` CLI:

```bash
# 1. Start PostgreSQL (API defaults to localhost:5433)
docker run -d --name nextdocs-postgres -p 5433:5432 -e POSTGRES_USER=nextdocs -e POSTGRES_PASSWORD=nextdocs -e POSTGRES_DB=nextdocs postgres:15-alpine

# 2. Copy and configure environment variables
cp .env.example .env
# For local runs outside Docker, point the API at localhost:
# SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5433/nextdocs

# 3. Install JS workspace dependencies (from repository root)
pnpm install --frozen-lockfile

# 4. Start the API (from api/ directory; use mvnw.cmd on Windows)
./mvnw spring-boot:run

# 5. Start the web + realtime servers (uses Turborepo)
pnpm run dev
```

The `pnpm run dev` command at the root uses [Turborepo](https://turbo.build/) to run both the web frontend and realtime WebSocket server in parallel with a single command. To start them individually:

```bash
pnpm --filter web dev       # Web frontend only
pnpm --filter realtime dev  # Realtime server only
```

## Roadmap

- [x] Core features listed in [overview](#overview).
- [x] Polish blocknote editor experience.
- [x] Icons + covers for documents.

### Q4 2026

- [ ] Document version history and snapshots.
- [ ] Full-text search support.
- [ ] AI integration and MCP support.
- [ ] Workspace admin claim and Spaces.
- [ ] Databases with Table and Board view.

## License

Distributed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](LICENSE) for details.
