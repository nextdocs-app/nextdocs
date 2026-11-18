# Harbor 2026 roadmap

The roadmap is a bet list, not a promise list. We review it every six weeks and move anything we have not started.

## H1: trust the numbers

- Saved segments and shared filters.
- Anomaly alerts with a seasonal baseline.
- A reconciliation report customers can run themselves.
- CSV import that fails loudly and precisely.

## H2: answer faster

- A query cache for repeated dashboard loads.
- Warehouse pushdown for large scans.
- Saved answers that can be embedded in a customer portal.
- A public API for segment membership.

## Not doing this year

- A native mobile app. The responsive web app is enough for the support and executive use cases we hear about.
- A general-purpose ETL builder. Customers already have one; we should read from it, not replace it.
- Per-seat pricing experiments beyond the one draft in Product.

## How we choose

Every bet needs a named customer problem, a measurable outcome, and a team that can start within the quarter. A bet without all three waits.

> A roadmap date is a planning signal, not a customer commitment.

| Bet                   | Intended outcome          | Review signal                   |
| --------------------- | ------------------------- | ------------------------------- |
| Saved segments        | Reuse common analysis     | Weekly active segment owners    |
| Reconciliation report | Resolve billing questions | Self-serve report runs          |
| CSV import validation | Fix errors before upload  | Failed imports with a clear row |

## Review checklist

- [ ] The customer problem is named.
- [ ] The success measure has an owner.
- [ ] The team can start within the planned quarter.
