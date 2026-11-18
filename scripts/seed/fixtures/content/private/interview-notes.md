# Interview notes

Interviewer: {{name}}. Role: {{role}}. The candidate has been told the format: a short introduction, one practical exercise, and time for their questions.

## Signal summary

| Area | Evidence | Confidence |
| --- | --- | --- |
| Debugging | Walked through a production issue without jumping to a fix | High |
| Collaboration | Asked clarifying questions before proposing a design | High |
| Written communication | Notes were structured and easy to follow | Medium |
| Domain depth | Strong on data pipelines, lighter on permissions | Medium |

## Notes

The candidate described a migration that had gone wrong in the middle of a release. They separated the immediate mitigation from the root cause, and they were explicit about what they would do differently. That is the behavior I want in an incident review.

- Strong: made the trade-off between speed and safety explicit.
- Strong: credited a teammate for the detection.
- Watch: tends to over-explain when nervous.
  - Give a longer prompt next time and see whether the answer stays focused.

## Recommendation

Hire. The gap in permissions knowledge is teachable, and the debugging signal is stronger than the average for this level. Pair them with a permission-heavy project in the first month.

## Follow-up questions

1. How would you decide whether a cache is safe after a permission change?
2. What would you measure to know the migration succeeded?
3. Tell us about a review that changed your mind.
