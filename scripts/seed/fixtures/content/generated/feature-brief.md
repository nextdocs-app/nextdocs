# {{title}}

> **Owner:** {{owner}} · **Status:** {{status}} · **Review by:** {{review_date}}
>
> {{quote}}

## User problem

{{summary}} The first release should make the common path **obvious**, keep the advanced path _available_, and avoid coupling the experience to one customer setup.

## Requirements

- A user can find {{topic}} from the existing workspace navigation.
  - Keep the current keyboard flow intact.
  - Show a useful empty state before any data is available.
- Changes must be visible in the audit trail and reversible by an owner.
- Link to the [support playbook]({{reference_url}}) from the error state.

## Acceptance table

| Case               | Expected result        | Measurement      |
| ------------------ | ---------------------- | ---------------- |
| Typical workspace  | Completes without help | {{metric}}       |
| Missing permission | Explains the next step | Support contacts |
| Slow response      | Keeps entered work     | Retry success    |

## Rollout

1. Enable the feature for the internal workspace.
2. Review the first week of feedback.
   - Pause expansion if the error rate rises.
   - Share the decision in the launch channel.
3. Expand to the next customer group.

## Ready to ship

- [ ] Product and support have reviewed the copy.
- [ ] Keyboard and screen reader paths are usable.
- [ ] The rollback owner and dashboard are listed.

## Example request

```json
{
  "service": "{{service}}",
  "feature": "{{topic_slug}}",
  "enabled": true
}
```

**Decision rule:** ship when {{metric}} stays within the agreed target for five working days.
