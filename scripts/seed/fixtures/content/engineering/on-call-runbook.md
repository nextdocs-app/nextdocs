# On-call runbook

Harbor runs a single primary on-call rotation. The paging policy is simple: acknowledge **within 15 minutes** or the escalation path runs on its own.

## First five minutes

- Open the incident channel and post the alert name.
- Check the Harbor status board before touching anything.
- Confirm whether the alert is customer-facing.

## Escalation path

1. Primary engineer acknowledges the page.
2. Secondary engineer is paged if there is no acknowledgement after 15 minutes.
3. Engineering lead joins for any customer-visible outage longer than 30 minutes.
4. Support lead is notified before any public status update.

## Paging policy

Pages come from the ingest lag monitor and the availability prober. A single failed probe is not a page; three consecutive failures in two regions is.

## Handover

Write the handover note before you go offline, even when nothing happened. The next engineer should not need to read the whole channel to know what is still open.

## After the incident

Open a postmortem within two business days. Link it from the incident channel and from the service ownership map.

## Severity levels

| Level | Customer impact                              | Response                               | Status page     |
| ----- | -------------------------------------------- | -------------------------------------- | --------------- |
| SEV-1 | All customers cannot ingest or query         | Page primary and secondary immediately | Public incident |
| SEV-2 | One region or one large customer degraded    | Page primary, notify support lead      | Public incident |
| SEV-3 | A single feature is slow or partially broken | Handle in business hours               | No public post  |
| SEV-4 | Cosmetic or internal-only issue              | Next working day                       | No public post  |

When in doubt, start one level higher. Downgrading a SEV-2 after ten minutes is cheap; discovering a SEV-1 forty minutes late is not.

## Common pages

| Alert                      | First check                                      | Typical cause                                            |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `IngestLagHigh`            | Log lag dashboard, then consumer offsets         | A consumer is stuck or the warehouse is rejecting writes |
| `AvailabilityProbeFailing` | Status board and synthetic checks in two regions | Edge or DNS issue, not usually the application           |
| `QueryLatencyP99`          | Slow-query log and warehouse queue depth         | A large segment or a missing index                       |
| `WarehouseRejectedWrites`  | Warehouse status page and credentials            | Quota, schema drift, or an expired role                  |

Record what you checked in the incident channel, even when the check was clean. The next person should not repeat your work.

## Useful commands

```bash
# What is the collector seeing right now?
nd ingest status --region us-east-1

# Tail one customer's events without downloading the whole stream
nd ingest tail --account acme-42 --limit 20

# Compare log lag against the consumer group
nd ingest lag --group warehouse-loader
```

Never run a replay or a backfill during an active incident without the engineering lead. Replays write to the same consumers that are already behind.

## Handover template

- Current status and customer impact.
- What changed in the last two hours, including failed attempts.
- What you would try next and what you deliberately did not try.
- Who is waiting on a decision, and by when.
- Links to the dashboard, incident channel, and any open vendor ticket.

> If there is no customer impact, record the evidence before closing the page.

- [ ] Status board and alert source checked.
- [ ] Customer impact and start time recorded.
- [ ] Next owner acknowledged the handoff.
