# Known issues: CSV import

Maintained by Aisha Bello. Update this page before replying to a new report.

## Malformed row stops the whole import

An import fails at the first malformed row in versions before 2026.10. The error names the line number. Workaround: remove the row and retry.

## Windows line endings break headers

Excel exports with CRLF line endings can leave a trailing carriage return in the last header. Workaround: save as UTF-8 CSV from a text editor.

## Duplicate rows after retry

Retrying an import that partially succeeded can duplicate rows if the file has no `event_id`. Workaround: include `event_id` in the export.

## Large files time out

Files over 200 MB time out in the browser. Workaround: split by month. A server-side upload is on the roadmap.

## Timezone column is ignored

The importer reads timestamps as UTC. A timezone column is ignored rather than applied; convert to UTC before uploading.

## Quick reference

| Symptom                          | Workaround                        |
| -------------------------------- | --------------------------------- |
| First malformed row stops upload | Correct the named line and retry  |
| Header has a trailing character  | Save as UTF-8 CSV with LF endings |
| Retry duplicates rows            | Include a stable `event_id`       |

> Keep the original export until the import count matches the source file.

```csv
event_id,event_time,event_name
evt-1042,2026-10-17T09:15:00Z,activated
```

- [ ] Confirm the file encoding before asking for a new export.
- [ ] Check whether a previous attempt partially succeeded.
- [ ] Record the importer version in the ticket.
