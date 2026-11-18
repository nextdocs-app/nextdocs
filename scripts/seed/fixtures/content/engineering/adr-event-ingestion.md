# ADR-014: Event ingestion

Status: accepted. Owners: Daniel Okafor, Samir Haddad.

## Context

Customers send between 40 million and 900 million events per day. The previous pipeline wrote each event synchronously, so a slow warehouse made the collector slow as well.

## Decision

`harbor-ingest` accepts events over HTTP, writes them to a durable log, and returns 202 as soon as the write is acknowledged. Consumers read from the log at their own pace. The collector never waits for the warehouse.

## Consequences

- Ingest availability no longer depends on warehouse availability.
- Delivery is at-least-once. Consumers must be idempotent on `event_id`.
- The log is the source of truth for replay; the warehouse is a derived view.
- Operators need a new dashboard for log lag and consumer offsets.

## Rejected alternatives

**Synchronous writes to the warehouse.** Simple, but couples ingest latency to warehouse latency.

**Batch uploads only.** Cheaper, but customers need per-event acknowledgement for their own retries.

## Review

Revisit this decision if log retention cost exceeds warehouse query cost for the median customer.

## How it works

1. The edge accepts a batch, validates the envelope, and assigns a partition key.
2. `harbor-ingest` appends the batch to the durable log and waits for the write acknowledgement.
3. The API returns `202 Accepted` with the highest accepted offset.
4. Consumers commit offsets only after the warehouse transaction succeeds.
5. A replay job can rewind a consumer group to a recorded offset without touching the collector.

## Operational limits

| Limit              | Value      | Why                                                                  |
| ------------------ | ---------- | -------------------------------------------------------------------- |
| Maximum batch size | 5 MB       | Keeps a single append under the log's request timeout                |
| Maximum event size | 256 KB     | Larger payloads belong in object storage, referenced by id           |
| Retention          | 30 days    | Covers the longest customer replay window we support                 |
| Consumer lag alarm | 10 minutes | Long enough to ignore a deploy, short enough to catch a stuck loader |

## Rollout

- [x] Dual-write the new log for one region.
- [x] Move the warehouse loader to the log with idempotent writes.
- [x] Enable replay in staging and document the runbook.
- [ ] Remove the legacy synchronous path after the retention window.
- [ ] Delete the old offset table once no consumer reads it.

## Open questions

Retention cost grows with the number of small customers, not the largest ones. If the price of 30 days exceeds the warehouse cost for the median account, we will offer a shorter window and make replays an explicit paid operation.

> The durable log is the recovery boundary; a warehouse outage must not stop collection.

## Consumer configuration example

```yaml
consumer: warehouse-loader
delivery: at-least-once
commit_after: warehouse_transaction
replay_window_days: 30
```
