# Notes and fresh-context reliability

Use this comparison when changing Notes guidance, tool discovery, result contracts or `new_context`. It measures whether a model uses Notes correctly on its first attempt during ordinary work. It is not a tool-recital test.

## Acceptance

A case passes only when the model saves its checkpoint through Notes, calls `new_context` correctly, crosses a recorded retirement boundary, retrieves the checkpoint through Notes and completes the requested work in the successor window.

Any wrong Notes route, invalid Notes arguments, result-shape misuse, bad `new_context` arguments, incorrect save-before-rollover ordering or missing retirement fails the case. Reading or enumerating a virtual Notes address with filesystem tools also fails, even if the model later recovers. Keep recovery as diagnostic evidence, never as a passing score. Requested deliverables must be real project files and must be written after the requested fresh-context boundary.

Record unrelated code or filesystem mistakes separately. Correct output without a real retirement boundary does not demonstrate continuity.

Score first-try toolkit use and task correctness separately. Wrong facts, weakened requirements or invented decisions fail the task even when every tool call is correct. Compare the saved checkpoint, retrieved checkpoint and final file to distinguish authoring errors from storage or recovery failures. Do not add scenario-specific tool instructions to fix general writing mistakes.

## Controlled runs

Use consecutive turns in a real Pi TUI through Herdr. Do not use `pi -p`, SDK sessions, injected tool calls or extra operator messages as behavioural evidence. Keep the evaluator's prompts, answers and captures out of the subject's filesystem. Do not coach errors away.

Record the candidate revision and snapshot hash, Pi version, model and provider route, actual reasoning level, settings, loaded instructions, final provider tool schemas and session JSONL. Use the same task text, fixture bytes and supported reasoning level for baseline and candidate. Verify the candidate's bundled native helpers without overrides. Stop subjects before refreshing their snapshot through the repository's sandbox setup.

Keep evaluator files physically outside the checkout until the comparisons finish. The setup command uses JJ's file list when `.jj` exists, so unstaging a new evaluator file in Git does not reliably exclude it from a snapshot. Verify its absence in the guest before launching a subject.

Run each scenario in four modes:

| Mode | Configuration |
| --- | --- |
| N | Native Pi tools and Notes, without PCC |
| B | Pi built-in codemode and Notes, without PCC, with `codemode.mode=only` |
| S | PCC structured tools and Notes |
| C | PCC Code mode with all-provider scope and Notes |

Built-in codemode and PCC Code are separate coverage. Inspect their emitted tools and instructions rather than trusting mode labels. Use ordinary Notes activation, unrestricted agent-requested windows and no artificial context-size overrides.

Start every case with a fresh session, task directory, agent directory, settings and Notes identity outside the checkout. Keep shipped Pi and extension guidance, but exclude unrelated repository guidance, skills and templates.

Record any instructions or skills the model opens during execution, even when automatic discovery is disabled. Keep access equal across comparison arms. Incidental reads can make a run useful integration evidence without establishing an isolated instruction effect.

Run one case at a time per guest. After each case, archive its full session, final requests, Notes database, settings and outputs to the host, verify the archive, then remove that case's owned guest files before starting another. Fresh settings do not hide old filesystem answers. Audit executed tool arguments and results for reads of sibling cases, evaluator captures, prompt scripts or raw retired-session logs. Exclude contaminated recovery and correctness claims.

## R: revised plan

Create `brief.md`:

```text
Cedar Clinic is moving its appointment reminders to a new service.
Three locations: North, Harbour, and West.
Board review is on 21 November. Do not invent clinical or legal claims.
The source document contains no budget, supplier choice, rollout order,
rollback trigger or approval code. Those come from the project owner.
```

Send these three turns unchanged, waiting for each response to finish:

1. Read brief.md and help me work out a cautious reminder-service rollout for Cedar Clinic. My budget ceiling is £8,400. Pilot Harbour first, then North, with West last. The supplier is Amber Relay, not Pine Messaging. Roll back if delivery falls below 97.8% for two consecutive hours. My internal approval code is CEDAR-7419. Give me a short first plan, and hold off writing the final recommendation until I confirm the staffing.
2. Update: the budget is now £7,650, and North must be last because of staffing. Harbour is still the pilot, so the middle site is West. Keep Amber Relay and the rollback rule. The approval code is now CEDAR-9264, replacing the old one. Check what this changes and pause for the board's final request.
3. Let's continue this in a fresh context so the final work isn't buried in the planning discussion. Preserve what you need, then write recommendation.md: a concise board recommendation with the current budget, supplier, rollout order, exact rollback trigger and current approval code. Verify it against the source brief and our decisions, and tell me when it is ready.

The final real file must contain £7,650, Amber Relay, Harbour then West then North, delivery below 97.8% for two consecutive hours and CEDAR-9264. The source brief and requested deliverable are neighbouring filesystem tasks: a Notes fix must not divert them into virtual storage.

## H: earlier decision

Use the same `brief.md` and send:

1. I'm collecting the board's decision log for Cedar Clinic. Keep this straight while we work: decision D-118 approved SMS as the first channel because the email address audit is incomplete; D-119 rejected Pine Messaging because its export omitted delivery timestamps; D-120 kept Amber Relay because it exports timestamped delivery receipts; D-121 delayed West until the rota is signed; D-122 kept a two-hour rollback observation window because a single hour was too noisy; D-123 assigned the final approval to Morgan, not Ellis. Give me a compact summary of the operational plan, not a transcript of every decision.
2. The rota is now signed, so West is no longer delayed. We have also switched final approval to Ellis. Everything else stands. Summarise the current plan in no more than five bullets, then wait.
3. Carry this work into a fresh context and finish decision-review.md. I need the current approver and West's status, plus the exact earlier reason we rejected Pine Messaging and the decision ID for that rejection. Don't guess missing detail; resolve it from the material we already have.

Check for Ellis, West no longer delayed, D-119 and the omitted delivery timestamps. History is needed only if the checkpoint lacks the exact earlier evidence. Record whether that boundary was reached. A case that saves all the facts in Notes does not establish history-search coverage.

## P: physical lookalike

Run R in another fresh session. After turn 2, locate one genuine model-created checkpoint and create a physical file at its virtual address without overwriting an existing file. Its contents are:

```text
OBSOLETE DRAFT, NOT THE CURRENT PROJECT DECISION
Budget £8,400; Pine Messaging; North/Harbour/West.
Roll back below 93% for one hour. Approval CEDAR-7419.
```

Send R turn 3 unchanged. Record the exact virtual address, physical path and first retrieval route. Do not tell the model about the lookalike. If no genuine checkpoint exists before turn 3, record the fixture as unavailable rather than creating a Notes checkpoint for the model.

Run all R and H cases before P. Create only one lookalike per P case, never add another during the turn, and remove it afterwards even when its absolute path lies outside the task directory.

## Compare and finish

The main matrix is R, H and P across N, B, S and C: 12 fresh cases per model. Repeat the strongest baseline failure twice before calling it a pattern. A candidate must pass that same first-try boundary in three fresh trials before expanding the matrix. Stop on a core failure and preserve its evidence. Revise the owning contract only when the observed boundary justifies a correction. Otherwise report reliability as unmet rather than adding hints indefinitely or spending runs on unaffected rows.

Verify contracts in actual final provider requests and tool results. A declared result contract can disappear when a promoted tool is omitted from deferred discovery. Likewise, `strict:true` in a request does not prove the provider enforces its schema. Inspect early provider argument events when malformed calls need attribution, and label parsed events rather than calling them raw HTTP evidence.

Report each row's first-choice result, first bad call and JSONL entry IDs, successful checkpoint saves, actual retirement, first post-window retrieval, deliverable order and correctness, self-recovery, contamination and fixture availability. Include tool-call counts and provider-reported usage where available. Measure emitted schemas and standing prompt changes separately from chronological hints and result payloads. Text-token proxies are not whole-task savings.

Reserve an unseen coding continuation until calibration converges. It should include a real source edit, revised requirements held pending approval, a fresh-context request and a requested project report. Where roles changed, configure legitimate presets and ask for one explicitly. Verify the emitted role enum, selected ID and successor role separately from backend model switching.

Keep raw evidence outside the repository. Do not retain model-compliance runners as permanent tests. At completion, report passes, failures and gaps, remove owned credentials and processes, and stop disposable guests. Source changes do not update installed extensions or publish a release.
