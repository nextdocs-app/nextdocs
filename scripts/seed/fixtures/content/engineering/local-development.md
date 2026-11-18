# Local development setup

Everything runs on a laptop with Docker, Node 24, and Java 21.

## Start the stack

```
npm ci
./nd dev
```

The stack starts Postgres on 5433, Mailpit on 8025, and the API, realtime server and web app on 8080, 1234 and 3000. Those are the first worktree's ports; every additional worktree gets free ones, so `./nd urls` is what prints the ports this checkout is actually on.

## Database

`./nd db` opens psql. `./nd db status` reports what is running and which migrations are applied. `./nd db reset --yes` recreates both databases; stop `./nd dev` first, because dropping a database under a live pool produces confusing reconnect errors.

## Seed data

`./nd seed` fills an empty database with a realistic organization. It requires the API and realtime server to be running, and both databases to be empty. Seeding is the only supported way to get a dataset that exercises search, comments, and sharing.

## Tests

`./nd test api`, `./nd test web`, and `./nd test realtime` run the suites. The API tests use H2 locally; migrations are only applied against the real Postgres container.

## Troubleshooting

If the realtime server cannot connect, check that Redis is running. If pages show stale content, check that Postgres and Redis are both up before blaming the editor.

## Service ports

| Service  | Default port | Local check                                  |
| -------- | ------------ | -------------------------------------------- |
| Web      | 3000         | Open the app in a browser                    |
| API      | 8080         | `curl localhost:8080/api/v1/instance/status` |
| Realtime | 1234         | Check the WebSocket server log               |
| Postgres | 5433         | `./nd db status`                             |

> `./nd urls` lists the ports this worktree was allocated; the table above is only the default.

> Reset only after stopping the stack; a live connection pool can reconnect during the reset.

## First run checklist

1. Install the root dependencies with `npm ci`.
2. Start the services with `./nd dev`.
3. Seed the local database with `./nd seed`.

- [ ] Docker is running.
- [ ] The web, API, and realtime services are healthy.
- [ ] The demo account can open a seeded page.
