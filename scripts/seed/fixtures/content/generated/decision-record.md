# {{title}}

> **Decision owner:** {{owner}} · **Status:** {{status}}
>
> {{quote}}

## Context

{{summary}} This decision favors a small operational surface over a flexible system that requires constant tuning.

## Options considered

| Option                | Benefit         | Cost                        |
| --------------------- | --------------- | --------------------------- |
| Keep the current path | No migration    | Slower {{topic}}            |
| Add a dedicated path  | Clear ownership | One more service to operate |
| Use a shared platform | Reuses tooling  | More coordination           |

## Decision

Choose the dedicated path for {{topic}}. It gives the owning team a clear boundary and keeps the customer-facing contract stable.

1. Add the service behind a configuration switch.
2. Compare {{metric}} against the current baseline.
3. Remove the old path after two successful release cycles.

## Consequences

- **Positive:** failures have a named owner and a narrow rollback.
- **Trade-off:** teams must keep the runbook and dashboard current.
- [ ] Revisit this decision after the next capacity review.

## Configuration sketch

```yaml
service: { { service } }
region: { { region } }
mode: gradual
rollback_metric: { { metric } }
```
