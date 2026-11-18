# {{title}}

> **Service:** `{{service}}` · **Primary:** {{owner}} · **Region:** {{region}}
>
> {{quote}}

## Signals

| Signal      | Normal range              | First check            |
| ----------- | ------------------------- | ---------------------- |
| {{metric}}  | Below the alert threshold | Compare both regions   |
| Error ratio | Under 1%                  | Inspect recent deploys |
| Queue age   | Under five minutes        | Check consumer health  |

## Response steps

1. Confirm the incident affects a customer.
2. Check the dashboard and the latest deploy.
   - Compare {{region}} with the healthy region.
   - Record the time range before changing anything.
3. Roll back only when the change is clearly correlated.

## Before handoff

- [ ] Post current impact and start time.
- [ ] Name the person taking the next shift.
- [ ] Link the dashboard and incident channel.

## Safe diagnostic

```bash
nd health check --service {{service}} --region {{region}}
nd events tail --service {{service}} --limit 20
```

Avoid **replaying the whole queue** during an active incident. A focused retry is safer; record any command that changes customer data.
