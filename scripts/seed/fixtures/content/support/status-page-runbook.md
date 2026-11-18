# Status page runbook

The status page is a customer communication tool, not an incident tracker. Update it when a customer can observe the impact, and keep the wording free of internal names.

## Who updates it

- The incident commander decides the severity and the first public message.
- The support lead publishes the update and owns the subscriber notification.
- Engineering supplies the technical detail; it does not publish directly.

## First update

Within 15 minutes of declaring a customer-visible incident:

1. Set the affected component and the status to `Investigating`.
2. Say what customers cannot do, not which service is unhealthy.
3. Give the next update time, even if the answer is "no change".

Example: "Some customers in the EU cannot load dashboards. We are investigating and will update by 14:30 UTC."

## During the incident

| Milestone | Status | What to say |
| --- | --- | --- |
| Cause identified | Identified | What broke and the workaround, if one exists |
| Fix deploying | Monitoring | The fix is rolling out; errors may continue for 10 minutes |
| Recovered | Resolved | Impact window and where the postmortem will live |

Do not promise a resolution time unless engineering has committed to one.

## After recovery

- Publish the resolved update before closing the incident channel.
- Link the postmortem within two business days.
- Review subscriber complaints at the next support stand-up.
