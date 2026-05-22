<p align="center">
  <a href="https://github.com/santhoshh-kumar/nextdocs">
      <img width="100%" alt="NEXTDOCS9" src="https://github.com/user-attachments/assets/3dcdd4e8-9e87-4a27-b729-70f50fd819db" />
  </a>
</p>

<h3 align="center">
  <em>An open-source, block-based collaborative document editor for individuals and teams.</em>
</h3>

<p align="center">
  <a href="https://github.com/santhoshh-kumar/nextdocs/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-3B82F6?style=flat-square" alt="License"></a> 
  <a href="https://www.blocknotejs.org/"><img src="https://img.shields.io/badge/Powered--by-BlockNote-7C3AED?style=flat-square" alt="BlockNote"></a> 
  <a href="https://yjs.dev/"><img src="https://img.shields.io/badge/Collaboration-Yjs-F59E0B?style=flat-square" alt="Yjs"></a>
  <a href="https://github.com/santhoshh-kumar/nextdocs/releases"><img src="https://img.shields.io/badge/Production--ready-Not%20yet-red?style=flat-square" alt="Production Status"></a> 
  <a href="https://github.com/santhoshh-kumar/nextdocs/releases"><img src="https://img.shields.io/badge/Release-Pre--alpha-orange?style=flat-square" alt="Release Status"></a>
</p>

<p align="center">
  <a href="#getting-started">Getting Started</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

## Overview

Platforms like Notion for document editing are powerful — until you realize you don't own your data. Centralized document platforms create vendor lock-in and reduce your control over how information is stored, shared, and governed.

This is where **NextDocs** becomes relevant.

For privacy-conscious individuals and organizations handling sensitive information, it's fully self-hostable, runs entirely on open technologies, and requires zero dependency on proprietary services. You deploy it. You control it. You own your data — end to end.

> Own your documents. Not just access them.

<h2>
  <img width="100%" alt="pre-alpha-overview" src="https://github.com/user-attachments/assets/2b801800-8722-4b06-954a-99185dd1d968">
  <p></p>
</h2>

### Block-Based Editing

A structured, Notion-like editing experience powered by [BlockNote](https://www.blocknotejs.org/). Compose documents using rich block types — paragraphs, headings, quotes, bullet and numbered lists, checklists, toggle lists, code blocks, tables, and embedded media. Inline formatting includes bold, italic, underline, strikethrough, text color, and links.

### Real-Time Collaboration

Multiple people edit the same document simultaneously with live cursors, presence indicators, and conflict-free merging — powered by [Yjs](https://yjs.dev/) CRDTs over a dedicated WebSocket server. See who's editing, where they're focused, and what they're typing, all in real time.

### Access Control

Per-collaborator access levels (Owner, Edit, Comment, View), link-based sharing with configurable permissions, and the ability to restrict access to specific collaborators only.

### Threaded Comments

Add contextual, threaded comments directly on document blocks. Comments are stored collaboratively in the Yjs document itself — no separate backend needed — so they sync in real time alongside content. Filter by open, resolved, or all; sort by position or date.

### Offline-First

Every document is persisted locally in [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API). Edit anywhere, anytime — even without connectivity. When you're back online, changes sync to the cloud automatically with conflict resolution. Bulk-import local documents when you sign in — means you can start creating documents without even signing up.

<br>

> [!IMPORTANT]
> This project is currently **unreleased** and **not yet hosted** online. It is under active development and not ready for production use.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 24.14.1 (LTS)
- [Java](https://openjdk.org/) 21
- [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/) (for PostgreSQL)
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

./nd format           # Format all code (Prettier + Spotless)
./nd build            # Build all packages

./nd db               # Open a psql shell to the database
./nd --help           # See all available commands
```

> [!TIP]
> If `./nd` doesn't have permission to execute, run `chmod +x nd` first. On Windows, use `nd.cmd` instead.

### Manual Setup

If you prefer to run services manually without the `./nd` CLI:

```bash
# 1. Start PostgreSQL
docker compose up -d postgres

# 2. Copy and configure environment variables
cp .env.example .env

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

## Architecture

NextDocs is a monorepo with three core services:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                                 NextDocs                                      │
├────────────────────────┬────────────────────────┬─────────────────────────────┤
│          Web           │          API           │          Realtime           │
│────────────────────────│────────────────────────│─────────────────────────────│
│ Next.js 16             │ Spring Boot (Java 21)  │ Node.js + Yjs               │
│ React 19               │ Flyway (Migrations)    │ WebSocket                   │
│ BlockNote Editor       │ Bucket4j (Rate limit)  │ CRDT Sync                   │
│ Redux Toolkit          │ ┌────────────────────┐ │                             │
│ IndexedDB (Offline)    │ │      In-Memory     │ │                             │
│                        │ │────────────────────│ │                             │
│                        │ │ Caffeine (Cache)   │ │                             │
│                        │ └────────────────────┘ │                             │
│ :3000                  │ :8080                  │ :1234                       │
└────────────────────────┴───────────┬────────────┴─────────────────────────────┘
                                     │
                                     │
                            ┌────────▼────────┐
                            │   PostgreSQL    │
                            │     :5433       │
                            └─────────────────┘
```

1. **Web frontend** serves the UI and BlockNote editor. Documents are cached locally in IndexedDB for offline access.
2. **API server** handles authentication, document metadata, sharing permissions, and persistent Yjs state in PostgreSQL.
3. **Realtime server** manages WebSocket connections for live collaborative editing using Yjs CRDTs — ensuring conflict-free concurrent edits. When multiple users edit a document, changes flow through the WebSocket server in real time, while periodic snapshots are saved to the database via the API.
4. **[Caffeine](https://github.com/ben-manes/caffeine) cache** provides in-memory caching with TTL and bounded size — keeping rate limiter buckets and hot data fast. Optimized for single-instance, self-hosted deployments, with a swappable interface that allows seamless migration to Redis for multi-instance setups.
5. **[Bucket4j](https://github.com/bucket4j/bucket4j)** enforces rate limiting on the API using the token bucket algorithm. Also optimized for single-instance deployments (since buckets are kept in Caffeine), with a swappable interface — simple by default, adaptable as scaling needs evolve.

> More detailed architecture will be available via Documentation soon before V1 release.

## Roadmap

**Planned for initial release**:
- [x] Core features listed in <a href="#overview">overview</a>.
- [x] Trash documents with recovery and auto-delete after 30 days.
- [ ] Search Documents by content.
- [ ] Polish blocknote editor.
- [ ] OAuth login (Google, GitHub).
- [ ] Document options like Export, font-options, etc.
- [ ] Responsive design for all screen sizes.

**Not planned for initial release**:
- [ ] Document version history and snapshots (Coming soon in blocknote itself).
- [ ] Workspace and team permission management.
