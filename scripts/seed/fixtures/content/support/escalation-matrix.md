# Escalation matrix

Escalate on impact, not on volume. One customer with a broken pipeline outranks twenty questions about a dashboard.

| Situation                      | First responder | Escalate to           | When        |
| ------------------------------ | --------------- | --------------------- | ----------- |
| Ingest lag over 30 minutes     | Support         | Data Platform on-call | Immediately |
| Query errors for one workspace | Support         | Core Platform on-call | 15 minutes  |
| Suspected data loss            | Support         | Incident commander    | Immediately |
| Billing discrepancy            | Support         | Finance and GTM lead  | Same day    |
| Security report                | Support         | Security engineer     | Immediately |

## How to escalate

Name the workspace, the impact, the time it started, and what you already checked. A page without those four facts will be sent back.

## Handback

The on-call engineer hands the ticket back with a summary and a next-update time. Support owns customer communication until the incident is closed.

> Escalate on customer impact and evidence; a high ticket count alone does not define severity.

## Handoff checklist

1. Confirm the affected workspace and the first observed time.
2. Attach a request id, dashboard, or reproducible example.
3. Name the next responder and the next customer update time.

- [ ] Impact is described in customer terms.
- [ ] The first checks and their results are recorded.
- [ ] Support knows who owns the next update.

```text
workspace: acme-42
impact: event ingestion delayed
started_at: 14:20 UTC
next_update: 15:00 UTC
```
