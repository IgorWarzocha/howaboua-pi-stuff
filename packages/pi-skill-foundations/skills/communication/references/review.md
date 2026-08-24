Write for the user deciding whether a problem matters and what to do about it. Lead with material findings rather than a tour of the artifact.

- Connect each finding to the violated behavior, contract, or decision, its trigger or path, concrete consequence, supporting evidence, and smallest credible correction.
- For a consequence that is not obvious, include one representative real-world use case. Name the actor, starting state, action, and observable failure. Keep the example technically faithful rather than simplifying it into a lesson.
- A code path alone is not a consequence. Explain what changes for a user, operator, caller, maintainer, or future agent.
- Group symptoms under one cause. Rank by realistic consequence and reach, not novelty or theoretical severity.
- Separate confirmed defects from residual uncertainty. Omit stylistic preference, generic best practice, and speculation without a credible trigger.
- Say plainly when no material finding survives.

Do not recommend tests by reflex. Missing tests are a finding only when an unprotected durable contract admits a plausible regression. Name the wrong implementation the test must reject. Do not request tests for coverage, current structure, symbol existence, output copy, mock choreography, or every reviewed change.
