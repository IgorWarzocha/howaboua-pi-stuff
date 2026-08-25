Start from marked failures. An outer tool result with `isError: true` is one incident even when several nested traces failed. A failed nested trace is still an incident when the outer Notebook result incorrectly says success.

Treat unmarked nonzero subprocess exits as a separate review queue. Commands such as `rg`, `diff`, and controlled failure probes legitimately return nonzero. Include them only when the task concerns shell failures or the marked-error chronology points at one.

A successful `exec_command` trace proves only the compound shell command's final exit. A failed early command can be masked by a later successful command. Do not classify broad output with generic error-word matching. Inspect a suspected result or reproduce it with fail-fast command chaining.

`notebook/template-interpolation-candidate` means a generic failed cell contained both `String.raw` and JavaScript interpolation syntax. It is a precise review filter, not proof that interpolation caused every selected failure. Inspect the call before attribution. Generic `Execution failed` records may hide either cell evaluation or a nested tool failure in older sessions.

The recovery chain is evidence of what happened next, not proof that the original operation completed:

- `same-tool success` means the same outer or nested tool later succeeded before the next user message.
- `user boundary` means the user spoke before an observed same-tool success. Inspect that boundary when the user corrected the agent or work silently moved on.
- `repeated` means the same tool failed again without an observed success in the bounded chain.
- `other success` means work continued through another tool. It does not establish recovery.

Prioritize recurring agent-owned failures, then harness defects:

1. repeated Notebook syntax, interpolation, persistent-binding, or wrong-tool errors;
2. repeated invalid arguments or sequencing at a model-facing tool boundary;
3. failed patch context caused by editing without a fresh read;
4. hidden nested failures, runtime startup faults, and correct-looking calls that fail in a cluster;
5. transient external or browser failures only when retries do not recover.

For a selected cluster, inspect the exact assistant tool call, result, and following calls at the reported lines. Reconstruct the session-time tool contract before blaming current instructions. Separate one initiating failure from retries and downstream errors. Fix deterministic code or runtime faults at their owner. Change tool names, schemas, usage, or skill guidance only when the cohort shows that the model-facing boundary caused the recurring mistake.

Finish with the audit window, marked and unmarked counts, dominant recurring signatures, recovery evidence, selected session examples, supported owner, and anything left unclassified. Do not call a retry successful merely because a later tool returned green.
