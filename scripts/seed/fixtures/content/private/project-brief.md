# Project brief

{{name}} owns the early shape of this project. The brief is intentionally short: it should be possible to read it in five minutes and understand why the work exists, what is in scope, and what would make us cancel it.

## Problem

Teams currently discover {{focus}} problems only after a customer reports them. The workaround is a spreadsheet maintained by one person, and it is wrong often enough that nobody trusts the totals. We need a small, shared view that updates without manual reconciliation.

## Goals

- Give the owning team one place to see the current state.
- Make the definition of done visible before work starts.
- Reduce the manual reconciliation to zero for the common case.

## Non-goals

- Replacing the warehouse or the billing system.
- Building a custom query language.
- Supporting every historical edge case in the first release.

## Approach

1. Start with the smallest data set that answers the main question.
2. Put the calculation behind one service, not in the UI.
3. Ship behind a flag to two design partners.
4. Measure before widening access.

```text
request -> permission check -> cached projection -> response
```

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| The source data is incomplete | Medium | Compare against a manual sample weekly |
| The cache hides a permission change | Low | Invalidate on grant changes |
| The team treats the first estimate as a promise | High | Publish the assumptions with the estimate |

## Decision needed

Do we start with the internal admin view or the customer-facing summary? Recommendation: internal first, because it lets support validate the numbers before we expose them.
