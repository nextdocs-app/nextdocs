# Seed fixtures

All seeded accounts use `<key>@nextdocs.test` and the password `NextDocs!2026`.
The demo login is `alice@nextdocs.test` (workspace owner); `daniel` is engineering,
`mei` product, `aisha` support, `elena` people ops, `tomas` security. The `small`
profile has 6 users, `regular` has 10 and `large` has 20. Every user also gets two private pages from the
`content/private/` templates: weekly review, 1:1 agenda, project brief, research notes,
decision log, interview notes, launch plan, runbook draft, reading list, incident
scratch notes, travel plan and budget draft. Two further root pages, Project brief —
Alice and Research notes — Daniel, are shared with complementary cross-functional
subsets: each author receives the other page, and every account is a recipient of one
of them, without making either page workspace-wide. `large` adds 100 generated
reference pages on top of the regular catalogue. `./nd seed` prints the demo login and
the account pattern when it finishes.

`scenario.js` is the source of truth for the Acme Inc dataset. The workspace itself
uses a blue `office-building-tall-2` builtin icon. Curated documents point at Markdown
files here. The large profile fills the four Markdown templates from a topic
list, so a reviewer can read each page layout without reading the seeder.

Every profile includes the Engineering handbook with nested runbook, architecture, and
local setup pages. The large profile adds 100 pages based on four richly formatted
Markdown templates.

## Add a document

1. Write `content/<space>/<slug>.md` as normal Markdown. Headings, lists, checklists,
   tables, quotes, inline styles, links, code blocks and images are supported.
2. Add an entry to `documents` in `scenario.js`:
   ```js
   {
     key: 'eng/example',
     title: 'Example page',
     space: 'engineering',
     file: 'engineering/example.md',
     author: 'daniel',
     createdDaysAgo: 120,
     updatedDaysAgo: 14,
     profiles: ['regular', 'large'],
   }
   ```
3. Add a builtin `icon` (`{ type: 'BUILTIN', value, color }`). Every page must have
   one; the icon slug must exist in `api/src/main/resources/icons/icons.json`.
4. Pick `profiles` explicitly. `small` is the fast smoke profile; `regular` is the
   default; `large` adds 100 generated pages across five spaces.
5. `createdDaysAgo` must be older than the space (`createdDaysAgo` on `spaces`) and
   `updatedDaysAgo` must be at most `createdDaysAgo`. Set `parent` to another document
   key to nest the page; parent entries must appear earlier in `scenario.js` and share
   the same space.

## Add a comment

Comments live on the document entry:

```js
comments: [
  {
    author: 'alice',
    createdDaysAgo: 12,
    body: 'Can we make this explicit?',
    anchor: { quote: 'the exact words from the page', occurrence: 1 },
    replies: [{ author: 'daniel', createdDaysAgo: 11, body: 'Done.' }],
    resolved: true,
    resolvedDaysAgo: 10,
    reactions: [{ author: 'mei', emoji: '👍' }],
    small: true,
  },
];
```

Rules enforced by preflight (the seed refuses to write anything if they fail):

- The quote must occur in the rendered text of one block, using `occurrence` to choose
  between duplicates. Backticks and Markdown syntax are not part of the quote; use the
  text a reader sees.
- Every author, replier and reactor must have access: either a COMMENT+ space grant or
  a page grant. The plan adds a page grant automatically when the fixture participant is
  outside the space.
- `small: true` marks the exact threads the `small` profile keeps.

## Add an attachment

1. Put a generated asset in `assets/` (SVG, PNG, or a small PDF). Do not reference an
   external URL.
2. Add it to `attachments` in `scenario.js` with `document`, `file`, `fileName` and
   `contentType`.
3. The seeder precomputes `<document id>/<attachment id>`, appends the block to the
   document and writes the metadata row. Document Markdown does not need a placeholder.

## Add a persona or space

Users and spaces live in `scenario.js` too. Space icon values must exist in
`api/src/main/resources/icons/icons.json`. A public space is readable by every
workspace member at `everyoneAccessLevel`; a custom space is visible only to its
`members`.

## Profiles

| Profile   | Users | Spaces | Documents | Threads | Comments | Attachments |
| --------- | ----- | ------ | --------- | ------- | -------- | ----------- |
| `small`   | 6     | 3      | 22        | 7       | 17       | 2           |
| `regular` | 10    | 6      | 38        | 19      | 35       | 4           |
| `large`   | 20    | 6      | 158       | 19      | 35       | 4           |

Counts are derived from `scenario.js`; the tables above are documentation, and
`lib/plan.js` computes the values `--verify` asserts.

## Determinism

Ids are UUIDv5 of `seed:v1:<kind>:<key>`. Documents shared by several profiles therefore
keep the same id. Re-seeding always follows `./nd db reset --yes`, so a fixture key is
stable across machines and runs.
