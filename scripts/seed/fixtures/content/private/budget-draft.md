# Budget draft: {{focus}}

Owner: {{name}}. This is a planning draft, not an approved budget. Numbers are rounded and assumptions are listed so they can be challenged.

## Summary

| Category | This quarter | Next quarter | Change |
| --- | --- | --- | --- |
| Infrastructure | 42,000 | 48,000 | +14% |
| Tooling | 9,500 | 9,000 | -5% |
| Contractors | 18,000 | 24,000 | +33% |
| Travel | 6,000 | 4,500 | -25% |
| Contingency | 5,000 | 6,000 | +20% |

## Assumptions

- Ingest volume grows 12% per quarter.
- The warehouse contract renews at the current rate.
- Two contractor months are needed for the migration.
  - If the migration slips, move that spend to next quarter.
  - If it expands, the contingency is not enough.

## Calculation

```text
infrastructure = base + (events / million) * unit_rate
contingency   = 10% of committed spend
```

## Open questions

1. Does the support tooling renewal include the new seats?
2. Is travel approved for the customer summit?
3. Which team owns the contractor invoice approval?

## Recommendation

Approve the infrastructure and contractor lines, hold the travel line until the summit agenda is confirmed, and keep the contingency under the engineering lead rather than splitting it across teams. A contingency nobody owns is just a bigger budget.
