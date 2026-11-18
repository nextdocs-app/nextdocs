# Engineering handbook

The shared starting point for building, operating, and changing Harbor. Each page has a clear owner and links to the deeper guidance below.

## How we work

- Keep decisions close to the code and record the reason when a choice is not obvious.
- Prefer small changes that are safe to deploy and easy to roll back.
- **Own the outcome** through monitoring and support handoff, not only through merge.

## Pages

| Topic                | Start here               |
| -------------------- | ------------------------ |
| Production response  | On-call runbook          |
| Architecture choices | ADR-014: Event ingestion |
| Local setup          | Local development setup  |

> When in doubt, leave the next person a clear path to reproduce what you saw.

## Change review

1. Read the owning page before changing a service.
2. Make the smallest reversible change.
   - Update the runbook when an operating step changes.
   - Link the decision record when behavior changes.
3. Ask another team to review shared contracts.

- [ ] The change has an owner and a rollback path.
- [ ] Monitoring and support notes are current.
