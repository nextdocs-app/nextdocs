# Database migration playbook

Every schema change ships as a forward-only Flyway migration. There are no down migrations in production; a bad migration is fixed by another migration, not by editing history.

## Before you write SQL

- Name the migration `V<next>__<short_description>.sql` and keep it under 200 lines.
- Add the new column or table first, backfill in a separate release, and only then make it required.
- Never lock a large table for a write in the same migration that reads it.
- Test against a copy of production data when the table has more than a million rows.

## Rollout sequence

| Step | Production change | Rollback |
| --- | --- | --- |
| 1 | Add nullable column and index concurrently | Drop the index and column |
| 2 | Deploy code that writes both shapes | Deploy the previous image |
| 3 | Backfill in batches with a pause | Stop the worker |
| 4 | Add the not-null constraint | Drop the constraint |

## Checking a migration

```bash
./nd db migrate
./nd db validate
./nd db info
```

`./nd db info` must show the new version as `Success` with no pending or failed rows. If a migration fails halfway, fix the SQL in a new file; do not delete the failed history row except through `./nd db repair` on a local database.

## After the deploy

- Watch write latency and replication lag for ten minutes.
- Confirm the old code path is unused before deleting a column.
- Record the migration number in the release notes.
