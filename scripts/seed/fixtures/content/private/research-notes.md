# Research notes: {{focus}}

I am collecting evidence before proposing anything. These notes are deliberately messy: quotes stay verbatim, observations are separated from interpretation, and every claim gets a source.

## What I heard

> "I do not need another dashboard. I need to know which number to trust."

That sentence came up in three conversations with different teams. The common thread is not missing data; it is missing confidence in the definition.

- Support trusts the ticket count but not the resolution time.
- Product trusts the funnel but not the workspace count.
- Finance trusts neither until the month closes.

## Where to look next

- Billing export for the last two quarters.
  - Compare the workspace total against the admin list.
  - Check whether trials are included.
- Support sample of 30 tickets mentioning reconciliation.
- The current spreadsheet's change history.

## Interpretation

The request is probably not a new tool. It is a shared definition with an owner and a visible source. If we build a view without settling the definition, we will ship a fourth number that nobody trusts.

## Open questions

1. Who is allowed to change a definition?
2. How long do we keep historical definitions?
3. What is the smallest disagreement we can resolve this month?

See also [the metrics glossary](../product/metrics-glossary.md) and the [status page runbook](../support/status-page-runbook.md).
