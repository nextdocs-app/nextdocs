# Decision log

A short record of decisions made by {{name}} and the team. The point is not to document every choice; it is to make the reversible ones cheap to revisit and the irreversible ones hard to forget.

## 2026-11-12: Start with the internal view

**Context.** The {{focus}} project has two possible first releases. The customer-facing view is more visible, but the data quality is unproven.

**Decision.** Build the internal admin view first. Expose it to support for two weeks, compare it with the manual sample, then decide whether the customer view is safe.

**Consequences.**

- The first release has no external announcement.
- Support gets a feedback loop before customers see the numbers.
- The customer view slips by roughly three weeks.

## 2026-11-05: One source of truth

**Decision.** The projection service is the only place that calculates the metric. The UI may format it but may not recompute it.

**Why.** Two implementations drifted by 4% within a month. The difference was invisible until finance compared a board deck with the billing export.

## 2026-10-28: No new queue

**Decision.** Use the existing job runner for the backfill instead of adding a queue.

**Revisit if.** The backfill exceeds four hours or blocks the interactive path for more than a minute.

## Template

| Field | Meaning |
| --- | --- |
| Context | What forced a choice |
| Decision | What we chose |
| Consequences | What becomes easier or harder |
| Revisit if | The signal that should reopen it |
