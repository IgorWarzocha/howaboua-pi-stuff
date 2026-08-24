Write for action without requiring the original conversation. Rewrite prose that sounds synthetic or could fit another issue after swapping nouns. Remove empty template prompts.

Title:

- Name the affected behavior or desired outcome.
- Keep required project or component prefixes.
- For bugs, name the symptom rather than a guessed fix.
- Avoid vague titles such as `Software crashes`.
- Prefer specific titles such as `Reloading a session crashes during delayed widget rendering`.

Optional style shortcuts:

- **Daniel Stenberg:** trigger, actual and expected result, relevant version, stop.
- **Brad Fitzpatrick:** minimized input, observed output, exact behavior in question.
- **Russ Cox:** current mechanics, proposal or question, consequences, uncertainty.
- **Niko Matsakis:** background, current state, constraints, open decisions.

Mix, choose, or ignore them. Never mention the style prompt.

Bug: give the shortest known reproduction, frequency, impact, and only relevant environment, logs, or artifacts. State when it is intermittent or not reproducible. Separate observation from suspected cause.

Feature, proposal, or investigation: give the current limitation or question, desired outcome, reason and evidence, completion conditions, and material constraints or open decisions. Include implementation detail only when already constrained or accepted.

Keep independently actionable problems separate unless they must complete together. Links do not replace context. Apply metadata only when established by the user or repository. Stop after filing unless implementation was requested.
