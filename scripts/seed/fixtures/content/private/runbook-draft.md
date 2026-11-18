# Runbook draft: {{focus}}

Status: draft. Owner: {{name}}. This is not yet the authoritative runbook; it is the place to collect the checks that actually work.

## When this page applies

The alert fires when the {{focus}} signal stays above its threshold for ten minutes. A single spike is not enough; check the dashboard before opening an incident.

## First checks

1. Confirm the alert is current, not a stale notification.
2. Compare the primary and secondary regions.
3. Check the dependency status page before assuming our code is at fault.

```bash
nd status --component {{focus}}
nd logs --since 15m --filter error
```

## Triage table

| Symptom | Likely cause | Next action |
| --- | --- | --- |
| One region only | Edge or DNS | Check provider status |
| All regions, one account | Large query or bad key | Contact support |
| All regions, all accounts | Recent deploy | Compare with last release |

## Mitigation

- If a deploy is the likely cause, roll back before investigating.
- If the dependency is down, publish the status update and wait; do not restart healthy services.
- If a single account is affected, isolate it with a rate limit instead of taking the system down.

> Restarting is not a diagnosis. Write down what you saw before you restart anything.

## Follow-up

Open a postmortem within two business days. Link it here and add the missing check to this page.
