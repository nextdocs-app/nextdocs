# Incident scratch notes

Keep this page open during the incident. It is raw on purpose; the postmortem comes later, after the facts are stable.

## Timeline

| Time (UTC) | Event | Source |
| --- | --- | --- |
| 09:12 | Alert for {{focus}} fired | Pager |
| 09:14 | Primary acknowledged and opened the channel | On-call |
| 09:18 | Error rate confirmed in two regions | Dashboard |
| 09:24 | Last deploy identified as the likely trigger | Deploy log |
| 09:31 | Rollback started | Release bot |
| 09:39 | Error rate back to baseline | Dashboard |

## What I checked

- Deploy history for the last two hours.
  - Nothing else changed in the window.
  - The previous release had no related errors.
- Dependency status: all green.
- Database connections: normal, no saturation.

## Hypothesis

The new code path opens a connection per request when the cache misses. Under the morning load, the pool saturates and requests queue until they time out. The rollback removes the path, which matches the recovery.

## Follow-ups

- [ ] Confirm the pool metrics at 09:20.
- [ ] Add a saturation alert, not just a latency alert.
- [ ] Write the customer-facing summary.
- [ ] Check whether the cache hit rate changed before the incident.

> Do not paste customer data into this page. Link the ticket instead.
