# Notes reliability findings

First-try reliability is not established. Neither model passes the fresh AJ rerun of the simplified contracts. Successful repairs, correct final facts and held-out transfers do not erase failed tool use or window ordering.

## Frozen AJ rerun: 3 November 2026

AJ tests Git `efd71cf2`, including the reviewed prompt changes, generic public Notes output declaration and History offset filtering. Both guests use the same snapshot, SHA-256 `c1fba37dca7fe80b40718235dc543ea4ca9a18ebc4c9a71a6ea93a9713395987`. The critical Notes and PCC files match the frozen Git source. Subjects use native OpenCode Go routes, high reasoning, Pi 1.5.0 and bundled helpers without overrides or rebuilds.

Each model completes 22 fresh three-turn TUI cases: the twelve main cases, six additional revised-plan trials, two repetitions of its earlier critical failure boundary and two held-out invoices. Every R and H case finishes before P begins. There is no coaching, candidate tuning, replacement case or baseline replay.

| First-try Notes and ordering gate | GLM 5.3 Flash | DeepSeek V4.1 Flash |
| --- | --- | --- |
| All 22 cases | 12 pass, 10 fail | 15 pass, 7 fail |
| R native | 3/3 | 2/3 |
| R built-in codemode | 1/3 | 0/3 |
| R PCC Code | 0/3 | 2/3 |
| Repeated earlier failure boundary | H structured: 2/3 | P Code: 2/3 |
| Held-out invoice Notes, ordering and role selection | 2/2, diagnostic | 2/2, diagnostic |

The cohorts have different critical-boundary repetitions, so their totals are not a controlled model ranking. The gate covers all Notes use, including completion checkpoints, as well as retirement, retrieval and delivery order. It is not a score for pristine task execution.

### Failed boundaries

GLM still invents `tools.notes.read` and `tools.notes.write` methods, supplies an unsupported `body` field, and misreads a valid Notes object through `current.text` or `current.content` instead of `file.content`. It also accesses a virtual Notes address through shell. One post-delivery completion cell creates a stray `cider` placeholder note before updating the correct `cedar` checkpoint. That is a wrong-target Notes operation, not storage corruption or a failed earlier recovery.

DeepSeek's seven failed cases all write the requested final document before rollover or omit rollover entirely. In one built-in case it calls `tools.new_context` inside codemode, then repairs the native transition. In another it claims the native tool is unavailable even though the actual request declares both `codemode` and `new_context`. GLM also writes a final document before rollover and calls `new_context` inside Code. Later retirement does not repair premature delivery.

Both models expose a contract mismatch at the save gate. GLM H-S3 and DeepSeek R-C2 save Notes, perform intervening filesystem work, then receive a guard rejection. The delivered description says to save before calling, and window guidance says to call after saving. Neither explicitly requires tool adjacency, but the runtime guard requires the immediately preceding successful own save. These cases establish that mismatch, not that a model ignored an explicit immediacy instruction. The candidate remains unchanged.

Supported `content` to `text` normalisation is valid and is not scored as an argument failure. Object transport remains intact. Wrong result-field use is a caller error, not evidence that Notes returned a string. This rerun does not isolate the generic declaration from the other contract changes or establish which change caused a particular model choice.

### Facts, lookalikes and transfer

All twenty final planning documents per model contain the required current facts. Some also introduce unsupported schedule, authority or budget-control assertions. Those authoring concerns are separate from the Notes and ordering gate. Proposed cautious steps are not automatically treated as invented owner decisions.

All ten genuine physical-lookalike fixtures are available and avoided: four GLM cases and six DeepSeek cases, including its P-C repetitions. No observed filesystem access retrieves a decoy or earlier conversation log. GLM's unrelated virtual-path shell access remains a failure even though no decoy is exposed.

All four held-out invoice cases use the configured delivery role, retire the old context and read Notes before approved follow-up edits. Turn 2 leaves source and tests unchanged. Final modules pass the subjects' checks and independent copied-source checks, including voided exclusion, refunds, zero quantities, unchanged inputs and the exact `-500` example. Both roles share the subject's backend, so this is role-selection coverage, not model-switching coverage. GLM Code repairs ordinary JavaScript and patch errors; its final functional result is not a pristine first attempt.

History is naturally invoked in GLM H-S2 and R-S, and DeepSeek P-N. Every H checkpoint already retains the exact earlier rejection evidence, so the missing-detail recovery boundary remains unexercised. No case exercises History read offsets or query-only search. The rerun therefore does not add live coverage for the new offset-filtering behaviour.

### Evidence and cleanup

The cohorts contain 337 GLM requests and 334 DeepSeek requests, with 557 outer calls and 282 nested calls in total. Provider-reported usage totals 3,064,104 tokens. These are whole-run observations, not a baseline comparison, billing measurement or cache-saving claim. Native schemas, built-in return declarations, PCC callable contracts, standing instructions and chronological window guidance are captured separately.

All 44 durable archives are independently hash-verified by the coordinator. Captures retain actual requests, parsed provider events, sessions, settings, created Notes databases and final outputs. GLM's malformed History argument has a recorded parsed-event versus persisted-argument mismatch. Three DeepSeek attempts record request timeouts with no returned parsed events. These are not raw HTTP captures, and no model-versus-server attribution is inferred.

Two DeepSeek operator interruptions preserve the same subjects: an assertion incorrectly expects argument deltas after a turn with no tool calls, and an archive helper stops after collection. Neither causes an extra user prompt or replacement run. No capture loss is identified. The earlier AI capture gap below remains historical evidence and is not repaired by these new runs.

Evaluator documents remain outside every guest snapshot throughout the rerun. Each case is host-archived and verified before owned guest files are removed. Credential scans find zero Go-key hits. Both guests are cleaned, stopped and disconnected, and the evaluator documents are restored. No host installation or publication occurs.

Per-model reports, matrices, exact first-bad requests and raw archives remain outside the repository. The findings below retain the original candidate labels and evidence limits.

## Earlier implementation changes

Notes now declares its output schema and publishes one canonical structured object through released Pi APIs. Pi's built-in codemode and PCC Code consume that same value. Built-in callers no longer need to parse Notes JSON text. Native display text remains JSON, and History's existing transport is unchanged.

Shared-note aliases and availability warnings preserve the structured value. Protected outputs remain opaque receipts in programmatic tools. Disposable checks exercised real Pi QuickJS and PCC against real Notes storage. Those checks establish the result boundary, not model reliability.

Earlier candidate contracts distinguish virtual checkpoints from project files, expose supported discovery and revision actions, identify read and write result fields, and specify current-turn saving immediately before a requested window switch. AJ simplifies those contracts as evaluated above. Requested deliverables remain filesystem work.

## Earlier live runs

The subjects are OpenCode Go's GLM 5.3 Flash and DeepSeek V4.1 Flash, using native provider routes and high reasoning. Each case has fresh settings, storage identity and task files. Subjects receive the same three ordinary task turns through Pi's real TUI in a disposable guest. Operator repairs, injected tool calls and SDK sessions are not acceptance evidence.

The baseline failed the native revised-plan scenario in all three runs on each model. Later candidates improved specific boundaries, but their clean rows do not establish acceptance for the final contract.

Native first-try reliability remains unmet. GLM's first AD native case sends malformed arguments containing XML-style markers. The first parsed provider argument fragment already has the wrong fields, despite a correct schema and a previous successful write. Notes rejects it. The valid retry and correct later recovery do not erase that failure.

The captured events establish that this malformed call predates Notes normalisation. They cannot establish whether the model or the provider's server-side parser produced it. Earlier strict-sampling experiments also failed to demonstrate enforced constraints. No local XML repair or speculative argument alias has been added.

Rather than adding a speculative native argument repair, the remaining modes receive diagnostic coverage. This is a disclosed evaluation-plan change, not a lowered acceptance threshold. Native failures remain visible and prevent a whole-candidate pass.

Both models complete three fresh built-in Notes and rollover chains under AD and three PCC Code chains under AE. Ordinary JavaScript and authoring defects remain explicit. Later history scenarios omit the History action before consulting its deferred contract and fail first try. AF's positive search example does not prevent recurrence on either model.

AG supports that unambiguous request directly: a History query without action defaults to search. Explicit actions remain authoritative, and ambiguous or invalid inputs are still rejected. The unsuccessful extra window reminder is removed. Disposable checks confirm identical implicit and explicit search results through native preparation, PCC and Pi 1.5.0 QuickJS.

Both models complete three fresh AG H-C Notes and rollover chains with all four requested facts. None naturally uses query-only search. GLM's checkpoints contain the earlier evidence in all three cases. DeepSeek recovers from Notes in two cases and uses History list and read in the other. These successful chains do not establish live query-only search coverage. GLM also completes H in native, built-in and structured modes without a Notes or rollover failure. Its native case repairs garbled project prose, and its built-in case overstates rollback sequencing. The second H-C case repairs an ordinary JavaScript syntax error. Those defects remain separate from the clean Notes operations.

Earlier results keep their original candidate labels rather than being presented as fresh whole-context AG trials. Shared Notes and ordering contracts are unchanged, but History's schema, default and chronological guidance differ.

## Selected main matrix

R tests a revised plan, H an earlier decision and P a physical lookalike at a virtual Notes address. The [procedure](notes-continuity.md) defines the prompts and modes. This table scores first-try toolkit use, not pristine task execution.

AD, AE, AG and AI are local candidate labels, not releases. These selected rows retain their actual source labels. They are not twelve fresh cases against one final candidate. Later History changes prevent a claim of identical whole contexts, even where Notes and ordering contracts are unchanged.

| Scenario and mode | GLM | DeepSeek |
| --- | --- | --- |
| R native | AD FAIL, malformed arguments | AD PASS |
| R built-in | AD PASS | AD PASS |
| R structured | AE PASS | AG PASS |
| R Code | AE PASS | AE PASS |
| H native | AG PASS | AG PASS |
| H built-in | AG PASS | AG PASS |
| H structured | AI PASS, History unexercised; AH failures retained | AI PASS, History exercised; AH failure retained |
| H Code | AG PASS, search unexercised | AG PASS, search unexercised |
| P native | AG PASS | AI PASS, transfer interruption |
| P built-in | AG PASS | AI PASS |
| P structured | AG PASS, evaluator interruption | AI PASS, partial-lookup warning |
| P Code | AI PASS, partial-lookup warning | AI FAIL, invalid window arguments and Code route |

AD's built-in repetition gate and AE's Code repetition gate are 3/3 per model. AG's H-C repetition gate is 3/3 per model. GLM has three fully captured AI H-S trials. DeepSeek has two fully captured H-S trials plus one session-only trial after an operator capture failure. These remain source-labelled evidence, not a final-candidate acceptance gate. GLM's failed AD native row is not erased by its clean AG native history scenario.

The twelve selected main cases contain 156 requests, 121 outer calls and 63 Notes invocations for GLM, and 212 requests, 188 outer calls and 72 Notes invocations for DeepSeek. The Notes count includes rejected invocations. Outer calls exclude tools composed inside Code. These counts describe the selected work, not an efficiency comparison.

DeepSeek's AG structured history case fails first try: after listing windows, it requests a read without the required item ID. Correct later recovery does not erase that error. AH adds the missing conditional requirement to that field's description. No new whole-window read or runtime argument repair is added. Its revised-plan structured case and native and built-in history cases have clean toolkit chains. Unsupported claims in the revised plan and an ordinary filesystem exploration error in the native history case remain separate task defects.

AH's second GLM structured history trial fails both malformed Notes arguments and premature rollover. The complete current-turn saving rule is delivered, and the existing guard correctly rejects the window call. DeepSeek's third AH trial makes valid History calls, then reads its raw session file and obtains the original owner messages. That bypass remains a recovery failure.

The preceding History results reveal a concrete mapping defect. Pi persists the initial user request before Notes' initial window message. History assigns that request to a synthetic pre-window bucket, so searches scoped to the advertised first window omit it. AI makes the first untrimmed window include that kickoff. Later window boundaries and retirement rules remain unchanged, and exact older read references remain usable. A disposable probe reproduces the missing result from the captured session and verifies the corrected result through native tools, PCC and Pi 1.5.0 QuickJS. Emitted contracts are unchanged. GLM completes three fresh structured history scenarios with 15 valid Notes calls and correct ordering and recovery. None needs History, so these runs do not establish live use of the corrected mapping. DeepSeek's first AI trial naturally retrieves kickoff entry `061a9ac5` under the advertised first window through valid History searches. Those queries are unscoped and explicit-action, so they do not establish live scoped-search or query-default coverage. Neither this fix nor later successful recovery erases the recorded first-try failures.

GLM's P-S setup is interrupted before the third prompt by an owned empty parent directory left after an earlier decoy. The runner refuses to overwrite it. The controller verifies and removes only that empty directory, then resumes the same session with the original third prompt and one genuine decoy. The subject does not access the leftover directory. This is an evaluator interruption, not a model failure or a pristine-environment claim. Unsupported allocation and authorisation claims in the final work remain task failures despite correct Notes recovery.

GLM's remaining AI P-C case ignores the genuine stale decoy and preserves all five current decisions. Its initial valid Notes list returns an explicit partial-lookup warning, as did some earlier cases. This is an availability qualification, not invalid invocation or proof of a complete empty store. No required own checkpoint is shown missing. Across the four fresh AI cases, 52 requests contain 21 valid Notes calls. All 41 outer arguments and 651 parsed provider events match the persisted records. History remains unused in all four.

DeepSeek's AI P-C case fails the window boundary at `395fffb0`, passing `{code:''}` to native `new_context`. It repeats with `{code:'{}'}`, then calls `tools.new_context({})` inside Code. The actual preceding request contains the empty native schema and the explicit instruction to call outside Code with `{}` and no code argument. The first bad call has no thinking text, so no motive is inferred. The later valid call is correctly rejected because the failed calls have intervened since the save. A new save eventually permits rollover, but that repair, correct final facts and an ignored decoy do not pass first try. No missing contract or owning runtime fault supports another reminder or argument alias.

## Held-out coding and role handoff

Both models complete the invoice continuation in native and PCC Code modes on the frozen AI candidate. All four use Notes correctly, select the configured delivery role, cross a real retirement boundary and recover the revised requirements before implementation. The initial quantity fix is requested in turn 1. The voided-line follow-up remains unimplemented through turn 2 and starts only after turn 3 approval and rollover. Source, checks and `review.md` remain project files on disk.

All four final implementations pass live checks and independent copied-source checks for voided lines, negative refunds, zero quantities, unchanged inputs and exact integer-pence arithmetic. The mixed refund and voided-line case returns `-500`. GLM Code mode repairs an ordinary malformed initial patch, which remains an attempt defect. GLM's two cases contain 37 requests and 11 valid Notes calls, with all 33 outer arguments and 460 parsed provider events matching the session. DeepSeek's two contain 38 requests and 11 valid Notes calls, with all 36 outer arguments and 4,016 parsed events matching and no error results.

The actual role enum, `new_context({role:'delivery'})` and successor `Role:delivery` are captured. Both configured roles use the same subject model and high reasoning, so this tests role selection, not switching model backends. These transfers do not erase earlier first-try failures.

## How to read the outcomes

- **Notes API:** the first invocation uses the correct route, method, arguments and result fields. A repaired invocation does not pass.
- **Window order:** a successful own save in the current turn immediately precedes native `new_context`, followed by a recorded retirement. Reading Notes in the original window is not fresh-context recovery.
- **Recovery:** the successor reads the saved checkpoint before requested deliverables. Raw conversation-file recovery or verification fails this route, even if it returns no facts.
- **Task:** the final work preserves the current decisions and constraints without unsupported claims. Unrelated JavaScript errors and incorrect checkpoint authoring remain separate defects. Correct backend storage does not excuse them.

All twelve main scenarios per model and all four held-out cases ran. Eight genuine physical-lookalike fixtures were available and avoided. These are selected diagnostic results across labelled candidates, not an all-fresh final-candidate acceptance study. The incomplete repetition capture below remains a gap.

## Evidence limits

Parsed provider events are compared with persisted arguments, text, reasoning, finish status and usage. They are not raw HTTP or raw model tokens. An earlier empty GLM successor remains an unexplained recovery failure. A later normal response does not establish its cause.

DeepSeek's third AI H-S trial has session evidence but no final-request, argument-delta or provider-event capture. The operator ran readiness after installing the observer, and readiness removed it. Collection correctly reported the missing files. This is a measurement failure, not a model failure or a fully verified third trial. The completed case is retained without a replacement run. Subsequent cases install and verify the observer after readiness.

DeepSeek's P-N setup also pauses before its decoy and third prompt when session transfer exceeds the sandbox result cap. The truncated artifact and collection error are retained. A bounded, byte-counted transfer retrieves the same session, then the original third prompt proceeds without a restart or extra subject message. This is an operator transfer correction, not a model failure or isolated product effect.

Evaluator documents and expected answers are kept outside guest snapshots. Session storage and runtime captures sit outside each task cwd. DeepSeek's earlier evaluator placed its agent directory inside the task cwd. That layout was corrected before AC. The failed earlier case remains failed, and comparisons across the correction cannot isolate an instruction effect.

Each case is archived to the host and hash-verified before its task files, agent storage, captures and owned bash spill files are removed. Tool arguments and results are audited for reads of earlier or foreign facts. Each physical-lookalike fixture uses a genuine model-created virtual checkpoint address. Owned credentials and observers are removed, and both disposable guests are stopped.

Emitted prompt and schema measurements use labelled reference token counts. They do not establish model-specific task savings or provider charges. Source changes do not update installed extensions or publish a release.
