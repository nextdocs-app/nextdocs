# Metrics glossary

A shared definition prevents two teams from reporting different numbers for the same word.

| Metric | Definition | Source | Owner |
| --- | --- | --- | --- |
| Weekly active workspace | A workspace with at least one query or ingest event in a rolling seven-day window | Product analytics | Mei |
| Ingest lag | Time between event receipt and availability for query | Collector metrics | Samir |
| Query success rate | Queries returning a result without an error or timeout | Query gateway | Daniel |
| Time to first query | Minutes from workspace creation to the first successful query | Onboarding funnel | Hana |
| Support resolution time | Median hours from ticket open to resolution | Support tooling | Aisha |

## Rules

- A metric has one owner and one source. If two dashboards disagree, the source of record wins.
- Report medians for latency and rates for success. Averages hide the slow tail.
- Break down by workspace plan before concluding that a product change worked.
- Retire a metric explicitly. An unused definition left in the glossary will be quoted in a board deck a year later.

## Open questions

Should trial workspaces count as weekly active? Current answer: no, because trial usage is dominated by a single evaluation session and inflates the number without predicting retention.
