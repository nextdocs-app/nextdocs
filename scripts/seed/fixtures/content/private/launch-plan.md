# Launch plan: {{focus}}

## Goal

Ship the change to every workspace without a support spike. Success means the new path is used by the majority of active accounts within two weeks, and the rollback is never needed.

## Timeline

| Day | Step | Owner | Exit condition |
| --- | --- | --- | --- |
| -3 | Freeze the branch and run the full suite | Engineering | Green build |
| -1 | Publish the help center update | Support | Link is live |
| 0 | Enable for internal workspaces | {{first}} | No errors in one hour |
| 1 | Enable for 10% of accounts | Engineering | Error rate below baseline |
| 3 | Enable for everyone | Engineering | Support queue stable |

## Checklist

- [ ] Feature flag has an owner and an expiry date.
- [ ] Rollback is a single flag change, not a redeploy.
- [ ] Support has the known-issues entry and the escalation path.
- [ ] The status page draft is ready but unpublished.
- [ ] Analytics events fire on the new path.

## Communication

The first note goes to the internal channel, not to customers. It names the change, the risk, and the person watching it. The customer note is shorter and links to the help page.

```bash
nd flags set new-ingest-path --percent 10 --owner daniel --expires 2026-12-01
```

## Rollback

Turn the flag off, confirm the old path is serving, and post the time in the incident channel. Do not delete the new code until the next release.
