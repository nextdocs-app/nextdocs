# Pricing experiment draft

Status: draft, not approved. Do not send this to customers.

## Hypothesis

A usage-based tier priced per million events will convert mid-market accounts better than the current flat team plan.

## Design

- Two cohorts: existing team accounts and new signups.
- Cohort A keeps the flat plan.
- Cohort B sees the usage tier with a calculator.
- Measure conversion, expansion, and 90-day retention.

## Concerns

Support cannot explain usage pricing without a calculator. Billing needs a reconciliation report before this can launch.

## Decision

Parked until the reconciliation report ships. The draft is kept for the next pricing review.

> Do not show a usage price until finance can explain the invoice from the same event totals.

| Cohort | Offer                      | Primary measure  |
| ------ | -------------------------- | ---------------- |
| A      | Existing flat team plan    | 90-day retention |
| B      | Usage tier with calculator | Paid conversion  |

## Restart checklist

1. Publish the reconciliation report.
2. Ask Support to review the calculator explanation.
3. Run the experiment for one billing cycle before expanding.

- [ ] Finance can reconcile sample invoices.
- [ ] Support has a customer-facing explanation.
- [ ] Stop conditions are visible on the experiment dashboard.

```json
{ "cohort": "B", "unit": "million_events", "price": "pending finance review" }
```
