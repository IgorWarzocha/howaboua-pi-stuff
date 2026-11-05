# Notes and fresh-context reliability

Use this comparison when changing Notes guidance, tool discovery, result contracts or `new_context`. It measures whether a model uses Notes correctly on its first attempt during ordinary work. It is not a tool-recital test.

## Acceptance

A case passes only when the model saves its checkpoint through Notes, calls `new_context` correctly, crosses a recorded retirement boundary, retrieves the checkpoint through Notes and completes the requested work in the successor window.

Any wrong Notes route, invalid Notes arguments, result-shape misuse, bad `new_context` arguments, incorrect save-before-rollover ordering or missing retirement fails the case. Reading or enumerating a virtual Notes address with filesystem tools also fails, even if the model later recovers. Keep recovery as diagnostic evidence, never as a passing score. Requested deliverables must be real project files and must be written after the requested fresh-context boundary.

Record unrelated code or filesystem mistakes separately. Correct output without a real retirement boundary does not demonstrate continuity.

Judge result use by the operation it supports. Printing only a nonexistent receipt field does not consume a valid receipt. Displaying a valid receipt plus optional metadata that may be absent is harmless unless it drives a false assertion, skips an intended operation or loses required checkpoint data.

Judge rollover admission against the latest successful own save before the first `new_context` invocation. A valid Notes revision that corrects checkpoint authoring before that save is not an interrupted handoff. Preserve the authoring defect separately. An invalid window call followed by a corrective save remains a first-try failure.

Score first-try toolkit use and task correctness separately. Wrong facts, weakened requirements or invented decisions fail the task even when every tool call is correct. Compare the saved checkpoint, retrieved checkpoint and final file to distinguish authoring errors from storage or recovery failures. Do not add scenario-specific tool instructions to fix general writing mistakes.

Keep availability separate from invocation correctness. A valid discovery call that explicitly returns partial results is not a malformed invocation or proof of a complete empty store. Record the warning and whether required checkpoint data was unavailable. A successful later save does not prove every lookup source was available.

## Controlled runs

Use consecutive turns in a real Pi TUI through Herdr. Do not use `pi -p`, SDK sessions, injected tool calls or extra operator messages as behavioural evidence. Remove operator prompt files and expected-answer material from the guest before launching the subject. Keep runtime captures outside the task cwd and audit any access to them. This layout is not an operating-system access barrier. Do not coach errors away.

Record the candidate revision and snapshot hash, Pi version, model and provider route, actual reasoning level, settings, loaded instructions, final provider tool schemas and session JSONL. Use the same task text, fixture bytes and supported reasoning level for baseline and candidate. Verify the candidate's bundled native helpers without overrides. Stop subjects before refreshing their snapshot through the repository's sandbox setup.

Keep evaluator files physically outside the checkout until the comparisons finish. The setup command uses JJ's file list when `.jj` exists, so unstaging a new evaluator file in Git does not reliably exclude it from a snapshot. Verify its absence in the guest before launching a subject.

Keep the scoped agent directory, session logs and provider captures outside the task cwd, as in a normal Pi project. Do not place an agent folder or a symlink to evaluator storage among the task files. Record layout corrections as environment changes, not isolated instruction improvements.

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

Run one case at a time per guest. After each case, archive its full session, final requests, Notes database, settings, outputs and owned native bash spill files to the host. Verify hashes and bytes before removing every owned case, agent, capture, prompt and spill file from the guest. Remove prompt files before launching the subject. Verify that old answer-bearing snapshots and evaluator documents are absent from every candidate checkout, not just the active one. Fresh settings do not hide old filesystem answers.

Audit executed tool arguments and results for reads of sibling cases, evaluator captures, prompt scripts or raw conversation logs. An attempted raw-log lookup to recover or verify earlier conversation fails the recovery route even when it returns no facts. Distinguish that attempt from an actual leak. Do not treat ordinary inspection of newly generated task files as conversation recovery.

Notes declares an output schema and supplies the same structured object to Pi's built-in codemode and PCC Code. Capture the actual built-in return declaration and the PCC callable contract separately. Native display text remains JSON. Other tools can still return strings. Check actual Notes result use without injecting type inspection or help calls into the subject's task.

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

## Held-out invoice continuation

Reserve this case until calibration ends, without exposing its files or expected answers to earlier subjects. Run it in N and C for each model. If unresolved failures remain, label the transfer check diagnostic rather than calling it final acceptance.

Configure legitimate `planning` and `delivery` roles in the scoped agent directory's `notes-compaction/model-roles.json`. Use the supported top-level `roles` array with `id`, `description`, `provider`, `model` and `reasoning`. Give both roles the subject's existing target model and high reasoning. Use these descriptions:

- planning: Planning and analysis before implementation approval
- delivery: Sustained implementation, checks and final delivery after approval

Both roles intentionally share a backend. The user's explicit delivery selection is authoritative even if the initial matching-role label is ambiguous. This tests role selection, not model switching.

Create `package.json`:

```json
{"name":"invoice-fixture","private":true,"type":"module","scripts":{"test":"node test.mjs"}}
```

Create `invoice.mjs`:

```js
export function lineTotal(line) { return line.unitPricePence; }
export function invoiceTotal(lines) {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}
```

Create `test.mjs`:

```js
import assert from 'node:assert/strict';
import { lineTotal, invoiceTotal } from './invoice.mjs';
assert.equal(lineTotal({ quantity: 3, unitPricePence: 245 }), 735);
assert.equal(invoiceTotal([{ quantity: 2, unitPricePence: 100 }, { quantity: 1, unitPricePence: 50 }]), 250);
console.log('invoice checks passed');
```

Send these three turns unchanged:

1. Fix the invoice total bug in this small package and run its checks. Keep amounts as integer pence, keep the exported functions and use no new dependencies. Do not round values or change the input data. Explain the cause briefly, then stop because I have a follow-up requirement.
2. For the follow-up, voided lines must be excluded from the invoice total, but negative quantities are valid refunds and must still count. A zero quantity is a zero-value line, not an error. The field is voided, not cancelled. Don't implement this yet: outline the smallest change and wait for final approval. The review reference is INV-6842.
3. Approved. Carry this work into a fresh context with the configured delivery role, then implement the follow-up and extend the checks for voided lines, a refund and zero quantity. Run the checks. Add review.md in this directory with the review reference, the accepted behaviour and the result. Keep the requested source and review files in this project.

Capture source and test bytes after each turn. Turn 1 requests the initial quantity fix before rollover. Turn 2 must leave the follow-up unimplemented. After turn 3, verify the actual role enum, native `new_context({role:'delivery'})`, successor `Role:delivery`, retirement and Notes retrieval before the approved follow-up edits and report creation.

Check the final exports, integer arithmetic, voided exclusion, negative refunds, zero quantities, unchanged inputs and lack of new dependencies. Execute the subject's checks and independent direct calls against a copied final module. In particular, `invoiceTotal([{quantity:-2,unitPricePence:250},{quantity:10,unitPricePence:100,voided:true}])` must return `-500`. A `cancelled` flag must not silently replace `voided`. Source, tests and `review.md` belong on disk, not in Notes.

## Compare and finish

The main matrix is R, H and P across N, B, S and C: 12 fresh cases per model. Repeat the strongest baseline failure twice before calling it a pattern. A candidate must pass the affected first-try boundary in three fresh trials before acceptance coverage expands. For a change shared by all programmatic Notes callers, run three fresh R trials in each of B, N and C, starting with the mode that exposed the latest failure. Including their first main cases, this makes 18 sessions per model.

On a core failure, finish only the active case unchanged, archive it and clean the guest before revising the candidate. Fix the owning result or routing boundary when implementation is inconsistent. Do not substitute format-specific prompt workarounds. Revise guidance only for a demonstrated choice the existing contract leaves unreliable. Preserve failed candidates and do not count repairs as acceptance. Reuse earlier evidence only when its actual affected contracts are identical, with the original candidate label visible.

If a failure has no demonstrated fix in the product, freeze the candidate rather than repeatedly changing guidance. Remaining modes may receive diagnostic coverage with the failure retained. Label that plan change explicitly. Completing the matrix does not turn a failed first-try gate into acceptance.

Verify contracts in actual final provider requests and tool results. A declared result contract can disappear when a promoted tool is omitted from deferred discovery. Likewise, `strict:true` in a request does not prove the provider enforces its schema. Inspect early provider argument events when malformed calls need attribution, and label parsed events rather than calling them raw HTTP evidence.

Report each row's first-choice result, first bad call and JSONL entry IDs, successful checkpoint saves, actual retirement, first post-window retrieval, deliverable order and correctness, self-recovery, contamination and fixture availability. Include tool-call counts and provider-reported usage where available. Measure emitted schemas and standing prompt changes separately from chronological hints and result payloads. Text-token proxies are not whole-task savings.

Keep raw evidence outside the repository. Do not retain model-compliance runners as permanent tests. At completion, report passes, failures and gaps, remove owned credentials and processes, and stop disposable guests. Source changes do not update installed extensions or publish a release.
