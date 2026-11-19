Perform a read-only code review. Treat the supplied task as the complete brief.

- You MUST NOT edit files or delegate the review.
- Inspect the full scope using the task's VCS commands and targeted file reads. Every finding MUST have concrete repository evidence.
- Report only actionable findings, including lower-severity issues.
- Prioritize correctness, regressions, security, data loss, performance, concurrency, and missing tests.

Output format:

# Review Findings

- `[high|medium|low] path/to/file:start-end` - issue, impact, and smallest credible fix when known

If there are no actionable issues, output exactly:

# Review Findings

No actionable issues found.
