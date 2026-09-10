<p align="center">
  <a href="https://github.com/santhoshh-kumar/nextdocs">
      <img width="100%" alt="NextDocs" src="https://github.com/user-attachments/assets/3dcdd4e8-9e87-4a27-b729-70f50fd819db" />
  </a>
</p>


<h3 align="center">
  <em>An open-source, block-based wiki and documentation platform for individuals and teams.</em>
</h3>

<p align="center">
  <a href="https://github.com/santhoshh-kumar/nextdocs/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-3B82F6?style=flat-square" alt="License"></a> 
  <a href="https://www.blocknotejs.org/"><img src="https://img.shields.io/badge/Powered--by-BlockNote-7C3AED?style=flat-square" alt="BlockNote"></a> 
  <a href="https://yjs.dev/"><img src="https://img.shields.io/badge/Collaboration-Yjs-F59E0B?style=flat-square" alt="Yjs"></a>
  <a href="https://github.com/santhoshh-kumar/nextdocs/releases"><img src="https://img.shields.io/badge/Release-Pre--alpha-orange?style=flat-square" alt="Release Status"></a>
</p>

<p align="center">
  <a href="#getting-started">Getting Started</a> ·
  <a href="#roadmap">Roadmap</a>
</p>


## Overview

<h3>
  <img width="860" alt="NextDocs editor screenshot" src="https://github.com/user-attachments/assets/6f2df608-c4b7-4a87-af6d-d40c51214561" />
</h3>

- **Block-based editing** — text, tables, media, code and much more.
- **Real-time collaboration** — live cursors and merging.
- **Hierarchical documents** — drag-drop, breadcrumbs, sidebar.
- **Sharing & access** — invites, links with role permissions.
- **Threaded comments** — synced live, resolvable.
- **Trash & recovery** — restore, auto-purge after thirty days.
- **Offline-first** — edit/create even when offline, auto-sync.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 24.14.1 (LTS)
- [Java](https://openjdk.org/) 21
- [Docker](https://www.docker.com/) (for PostgreSQL)
- [npm](https://www.npmjs.com/) (comes with Node.js)

### Quick Start

Use Node.js version 24.14.1 (LTS):

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

| Service | URL |
|---------|-----|
| Web app | http://localhost:3000 |
| API | http://localhost:8080 |
| Realtime WebSocket | ws://localhost:1234 |

### Development Commands

Use the `./nd` CLI for all development tasks:

```bash
./nd dev              # Start all services (auto-manages PostgreSQL)
./nd dev api          # Start only the API
./nd dev web          # Start only the web frontend

./nd test             # Run all tests
./nd test api         # Run API tests only

./nd lint             # Lint all code
./nd lint web --fix   # Lint + auto-fix frontend

./nd format --fix     # Format all code (Prettier + Spotless)
./nd build            # Build all packages

./nd db               # Open a psql shell to the database
./nd --help           # See all available commands
```

> [!TIP]
> If `./nd` doesn't have permission to execute, run `chmod +x nd` first. On Windows, use `nd.cmd` instead.

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
npm ci

# 4. Start the API (from api/ directory)
./mvnw spring-boot:run

# 5. Start the web + realtime servers (uses Turborepo)
npm run dev
```

The `npm run dev` command at the root uses [Turborepo](https://turbo.build/) to run both the web frontend and realtime WebSocket server in parallel with a single command. To start them individually:

```bash
npm run dev -- --filter=web       # Web frontend only
npm run dev -- --filter=realtime  # Realtime server only
```

## Roadmap

- [x] Core features listed in [overview](#overview).
- [x] Basic polish to blocknote editor.
- [ ] Icons + covers for documents.
- [ ] Document version history and snapshots.
- [ ] Search documents by content.
- [ ] Workspace admin and Teamspaces.
- [ ] OAuth login (Google, GitHub) — our first step in SSO for individuals and small teams.
- [ ] Document options like Import/Export, font-options, etc.
- [ ] Responsive design for all screen sizes.
- [ ] Enterprise-level SSO options.

## License

Distributed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
