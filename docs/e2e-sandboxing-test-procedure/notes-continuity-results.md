# Notes continuity review, 2 November 2026

First-try reliability across the requested modes was **not achieved**. Native Pi improved, but both models still failed in PCC Code. No later repair is counted as a pass.

## Comparison

The [procedure](notes-continuity.md) used real consecutive Pi TUI turns through Herdr, independent disposable guests, Pi 1.5 and unchanged OpenCode Go model routes with high reasoning. Candidate-bundled native helpers ran without overrides. Subjects received the same three task messages and source fixture, without tool coaching or injected calls.

| Evidence | GLM 5.3 Flash | DeepSeek v4.1 Flash |
| --- | --- | --- |
| Baseline native revised-plan task, three fresh trials | 0/3 clean Notes and rollover chains | 0/3 clean Notes and rollover chains |
| Earlier virtual-storage candidate, three fresh native trials | 3/3 first-try Notes, rollover and recovery chains | 3/3 first-try Notes, rollover and recovery chains |
| Final PCC Code candidate, three fresh trials | 2/3 first-try toolkit chains | 2/3 first-try toolkit chains |

The earlier native trials used the retained virtual-storage vocabulary. Subsequent changes added on-demand result help, a safe `address` spelling alias, a more explicit Code invocation and stronger deliverable ordering. Native trials were not repeated after those changes. Historical 3/3 results do not establish native acceptance of the final patch.

Both models failed the third fresh Code trial, so neither passed the repetition gate. All six final Code cases eventually saved Notes, called native `new_context {}`, actually retired the planning window, read Notes in the successor window and wrote the requested file afterwards. That eventual completion is diagnostic evidence, not first-try acceptance.

Toolkit use and task correctness are separate scores. GLM's second native recommendation weakened mandatory rollback to rollback consideration. Its third added an unsupported staffing assumption. Those remain task-fidelity failures despite correct tool use. DeepSeek's native outputs retained the required current facts and mandatory rollback. Its first trial independently read a shipped communication skill, so it is qualified as integration evidence rather than a perfectly isolated instruction comparison.

The untouched baseline covered R, H and P in native Pi, built-in codemode, PCC structured and PCC Code. GLM had 12 included main cases, with recorded exposure qualifications. DeepSeek executed 12, but one read another case's answers and was excluded. Neither baseline had an error-free complete task chain. These are not estimates of general failure rates.

## Changes retained

- Explicit virtual Notes storage, with project files and requested deliverables left on disk.
- Native system-level Notes routing and fresh-context ordering guidance, including PCC Code integration.
- An empty `new_context` argument object when no roles exist, or an enum of configured role IDs when they do.
- Result-shape guidance in the actual on-demand Notes help, plus actionable recovery hints.
- A compact Code discovery entry naming the one-function, asynchronous object interface and a valid awaited help call.
- An unadvertised `address` alias for `path`, with conflicting targets still rejected.

Existing note contents, receipt semantics and encrypted-result handling are unchanged. No upstream Pi patch, provider override or forced tool-choice policy was introduced.

## Concrete remaining failures

GLM's third final Code trial first called `tools.notes({action:'read'})` without a path in entry `f12c49d6`, apparently expecting help. Result `cb12c595` reported `notes read requires path`. Its following list and three writes put `await` outside the result printer instead of awaiting Notes. They printed `{}` for the Promises, although the underlying writes succeeded. Neither persistence nor later repair rescues the first-try score.

DeepSeek's third final Code trial correctly awaited Notes help, then printed `String(h).slice(0,1500)` in entry `6670eecd`. Result `09189f65` was `[object Object]`, losing the help contents. It repaired this with `JSON.stringify` in `7d961e56`, but the case remains failed. Its later rollover `fa526212`, retirement `cce91363`, Notes read `81b5e136` and file write `d21d98be` followed the correct order.

Earlier Code candidates also exposed unsupported namespace and action guesses, native rollover code wrappers, absent retirement and premature deliverables. The final trials improved those choices without eliminating result-handling failures. GLM's first final trial repaired an unrelated Python quoting error. DeepSeek's first two final trials repaired ordinary patch errors and inferred rollout timing that the owner had not supplied. Its third added unsupported quote and contingency history. Those remain task failures, separate from Notes persistence. No blanket whole-task pass is claimed.

## Contract delivery findings

An earlier Code trial exposed a real integration gap. Notes was promoted out of the deferred catalogue, so its adapter's result metadata never reached the model. The model explicitly searched the catalogue, then requested Notes help, but neither exposed `file.content`. It guessed `chk.content.length` and failed.

The final patch puts this contract in Notes' own help:

```text
read: file.content; write/append: file.path
```

DeepSeek's earlier corrected-help trial naturally received that field in result `93a4fa35` and the following provider request. GLM truncated its own help print to 400 characters before that field. Moving result guidance first made it survive that observed truncation. Delivered metadata and model-consumed metadata are different evidence boundaries.

The final Code discovery contract explicitly says `One function → Promise<object>; text(await tools.notes()) for help`, followed by supported action and argument names. Both routing and ordering SYSTEM guidelines and the callable contract reached all 40 final GLM requests and all 71 final DeepSeek requests, including successor windows. GLM still guessed a missing-path read and misplaced awaits. No final GLM case naturally requested no-argument help. DeepSeek's failing trial did request help, then converted its object incorrectly. These remaining failures are not evidence of an undelivered contract.

Preferred strict-schema sampling was also tried through Pi's supported API, then removed. Actual provider chunks contained unknown fields such as `text_2` despite requests declaring `strict:true` and `additionalProperties:false`. The observed arguments already contained those fields before Pi's tool-argument normalisation. This does not establish their internal model origin or constitute raw HTTP evidence. The extra nullable schema format added cost and errors without providing the intended protection.

## Cost and coverage limits

Reference o200k builder measurements for the final patch are 486 tokens for native schemas, 72 for the routing and sequencing guidelines and 163 for Code guidance in normal mode. The corresponding GPT-mode components are 485, 72 and 143. Compared with the untouched baseline, owned chronological window guidance grows from 257 to 278 tokens in normal mode and from 228 to 245 in GPT mode. On-demand Notes help adds 14 tokens for result fields. The virtual-storage usage hint adds 20 tokens to representative local results. These are separate component measurements, not either model's tokenizer or whole-task savings.

In DeepSeek's actual first requests, normalised native-tool JSON grows by 16 bytes and two reference tokens against the untouched baseline. Combined system and chronological instructions grow by 610 bytes and 128 reference tokens. The final two contract corrections account for 43 bytes and eight reference tokens of that instruction growth, with no native-schema change. These emitted-payload measurements remain distinct from builder components and provider billing.

The final full matrix, built-in codemode and structured-mode reruns, physical-lookalike reruns and reserved coding continuation were not completed after the Code gate failed. No required-History recovery coverage was established because the earlier-decision checkpoints already contained the requested evidence. Configured-role schema changes were checked with disposable real-configuration probes, not claimed as live model-switch acceptance.

Temporary subjects and credentials were removed and disposable guests stopped. The source patch does not update installed packages or publish a release.
