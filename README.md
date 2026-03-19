# Nextdocs

## Development

Use `./nd` — a unified CLI that wraps Maven (api), Turborepo (web, realtime), and Docker (postgres).

```bash
./nd dev              # start everything (api + web + realtime + postgres)
./nd dev api          # start only the api
./nd dev web          # start only the web

./nd test             # run all tests
./nd test api         # run api tests only

./nd lint             # lint all
./nd lint web --fix   # lint + auto-fix web

./nd format           # format all
./nd build            # build all

./nd db               # open a psql shell
```

Services: `api`, `web`, `realtime`. Omit the service to run across all.

> `./nd dev` auto-starts and stops a Postgres Docker container for you.  
> If secrets are not set, ephemeral dev values are generated — they won't survive restarts.
> `./nd --help` to know more about the commands.

Overall, `./nd` CLI makes developer's life easier in nextdocs. 

---

## Docker setup

Some values in `docker-compose.yml` are intentionally set to `CHANGE_ME_IN_PRODUCTION`.  
**The application will not start with these values outside of local dev** — see `.env.example` for all required variables and how to generate secure values.

```bash
cp .env.example .env
```