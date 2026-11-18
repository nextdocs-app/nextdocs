# PRD: saved segments

Owner: Mei Chen. Status: shipped in 2026.10.

## Problem

Analysts rebuild the same filter set several times a week. Support cannot link a customer to the exact view the customer described.

## Proposal

A saved segment stores a filter expression, a name, and an optional description. Segments appear in the sidebar and can be shared with a space.

## Requirements

- Create, rename, and delete a segment from the sidebar.
- A segment is private until shared with a space.
- Sharing a segment does not share the underlying events.
- A segment URL is stable and can be pasted into a ticket.
- Deleting a segment asks for confirmation and names the segment.

## Out of scope

- Scheduled exports of a segment.
- Segments that join two event streams.
- Per-user parameters inside a segment.

## Success

- 30% of weekly active analysts create a segment within their first two weeks.
- Support tickets that mention a segment link resolve 20% faster.

## Open questions

Should a segment in a private space be visible to workspace admins? Decision: no, space membership is the authority.

## Users and jobs

| User             | Job                               | Today                                             | After                                            |
| ---------------- | --------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Analyst          | Re-run the same weekly review     | Rebuilds six filters by hand                      | Opens a saved segment and changes the date range |
| Support engineer | Investigate one customer's events | Reconstructs the customer's view from screenshots | Opens the segment link from the ticket           |
| Admin            | Control who sees a saved view     | Shares a dashboard copy                           | Shares the segment with a space                  |

## User stories

- As an analyst, I can save the current filters with a name so I do not rebuild them next week.
- As an analyst, I can duplicate a segment and change one condition without starting over.
- As a support engineer, I can open a segment link and see the same events the customer described.
- As an admin, I can remove a segment from a space without deleting the owner's copy.

## Rollout

1. Ship creation and private segments behind a workspace flag.
2. Enable space sharing for design partners and watch the support ticket sample.
3. Publish the sidebar help text and a short video.
4. Enable for every workspace once the segment link resolves for a viewer who is not the owner.

## Metrics

| Metric                               | Target               | Source            |
| ------------------------------------ | -------------------- | ----------------- |
| Weekly analysts who create a segment | 30% within two weeks | Product analytics |
| Segment links opened from tickets    | 200 per week         | Support tooling   |
| Time to resolve a segment ticket     | 20% faster           | Support report    |
| Segments deleted within a day        | Under 5%             | Audit log         |

## Risks

- A shared segment can leak a filter that names a sensitive event. Mitigation: sharing never exposes raw events, and the viewer still needs query access.
- A segment URL can outlive the segment. Mitigation: a deleted segment returns a clear "no longer available" page instead of an empty result.

## Release checklist

- [ ] A viewer without edit access can open a shared segment.
- [ ] Removing access hides the segment on the next refresh.
- [ ] Deleted links show a recovery message.

```json
{
  "name": "Weekly activation",
  "filters": [{ "field": "event_name", "operator": "equals", "value": "activated" }],
  "sharedWith": "product"
}
```
