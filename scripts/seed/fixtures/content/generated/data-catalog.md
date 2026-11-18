# {{title}}

> **Dataset owner:** {{owner}} · **Refresh:** daily
>
> {{quote}}

## Definition

{{summary}} Use `{{metric}}` for trend comparisons only after the daily refresh is marked complete.

## Fields

| Field          | Type      | Meaning                 | Example   |
| -------------- | --------- | ----------------------- | --------- |
| `workspace_id` | UUID      | Owning workspace        | `acme-42` |
| `event_time`   | Timestamp | Time reported by source | UTC       |
| `value`        | Numeric   | Measured {{topic}}      | 18.4      |

## Calculation

```sql
SELECT workspace_id, date_trunc('day', event_time) AS day,
       avg(value) AS {{metric_slug}}
FROM {{service}}_events
GROUP BY workspace_id, day;
```

1. Exclude events without a workspace id.
2. Normalize timestamps to UTC.
   - Deduplicate by source event id.
   - Keep the original value for audit.
3. Publish only after the row-count check passes.

## Data checks

- [ ] Refresh completed for {{region}}.
- [ ] Null identifiers stay below 0.1%.
- [ ] A sample query matches the dashboard.

> Do not use incomplete current-day values for billing or customer commitments.
