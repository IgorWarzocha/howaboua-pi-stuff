const NOTEBOOK_HELP = `Actions use {"input":"<JSON action object>"}
Example: {"input":"{\\"action\\":\\"status\\",\\"query\\":\\"*\\"}"}

{"action":"status","query"?:string}  Memory, checkpoint and retained-state summary; query inspects matching live bindings
{"action":"list","query"?:string}  List saved profiles and isolated candidates, optionally filtered by name
{"action":"checkpoint"}  Persist current serializable state
{"action":"save","name":string}  Save current state as a named profile
{"action":"load","name":string}  Load a profile by value without replaying cells; release or rename colliding bindings first
{"action":"pin","names":string[],"hook"?:"startup"|"tool_result"|false}  Promote bindings to durable project state and protect from release/prune; omit hook to preserve it, false removes it
{"action":"unpin","names":string[]}  Remove pin protection and hooks, keeping bindings
{"action":"release","names":string[]}  Dispose and remove selected unpinned bindings; unpin protected bindings first
{"action":"prune","query":string}  Release unpinned bindings matching an explicit glob; pinned matches survive
{"action":"restart"}  Stop any active cell and restore the last completed checkpoint
{"action":"diagnostics"}  Check historical cells and runtime health without executing them
{"action":"reset"}  Stop any active cell and discard the session checkpoint; durable project state, saved notebook and named profiles survive

query uses case-insensitive * and ? globs. prune requires a nonempty query. names must be a nonempty array of binding-name strings. pin/release require existing JavaScript identifiers. Profile names: 1-64 letters, numbers, dots, underscores or hyphens, starting with a letter or number

Hooks must be self-contained fn(event), awaited when invoked. startup gets {type:"startup"} once per fresh kernel after restoration, not when pinned; Pi tools cannot run during startup. tool_result gets {type:"tool_result",toolName,input,status:"success"|"error",result?,error?} after nested tool settlement; handlers are awaited in name order and their tool calls do not retrigger hooks. Recreate imports and live handles inside the function. Startup failures block execution; unpin remains available. External side effects are not rolled back

Run management calls after exec returns. Inside exec, tools.notebook({action,...}) supports status without query, list and diagnostics only. release/prune may restart the kernel for lexical bindings, clearing runtime-only handles

Normal cells allow one active execution. isolated:true runs a separate Deno kernel from committed saved state, up to four isolated cells at once. Use wait to continue or terminate that isolated cell. Completion saves a named candidate without changing live state. list exposes candidates; load explicitly adds their saved bindings by value and rejects collisions, so release or rename colliding bindings first. Candidates never auto-adopt or replace the live kernel. Only checkpoint-supported state transfers, not arbitrary closures, types or imports. Tool and file effects are not rolled back`;

const TS_HELP = `Actions use {"input":"<JSON action object>"}
Example: {"input":"{\\"action\\":\\"status\\",\\"query\\":\\"*\\"}"}

{"action":"status","query"?:string}  Inspect live bindings and active cells
{"action":"list","query"?:string}  List saved profiles and isolated candidates
{"action":"checkpoint"}  Capture durable state; report live-only values not saved
{"action":"save","name":string}  Save durable state as a named profile
{"action":"load","name":string}  Add a profile by value; release colliding bindings first. A candidate-* name instead replaces the live kernel
{"action":"pin","names":string[],"hook"?:"startup"|"tool_result"|false,"checkpoint"?:{snapshot:string,restore:string}}  Retain durable bindings and protect from release/prune; omit hook to preserve it, false removes it
{"action":"unpin","names":string[]}  Remove pin protection, hooks and checkpoint registration, keeping live bindings
{"action":"release","names":string[]}  Remove selected unpinned bindings
{"action":"prune","query":string}  Remove unpinned bindings matching a glob
{"action":"restart"}  Restore the last durable checkpoint; live-only values and later changes are lost
{"action":"diagnostics"}  Inspect state and runtime health
{"action":"reset"}  Discard session state; project pins and named profiles survive

query uses case-insensitive * and ? globs. Lifecycle changes, save and checkpoint require idle cells. Inside exec, tools.notebook({action:"status"}), list and diagnostics are available. Release/prune rebuild the kernel so names are reusable; live-only values are discarded

Hooks use self-contained fn(event). startup runs once per fresh kernel, including isolated workers, after restoration, not when pinned; Pi tools are unavailable during startup. tool_result runs after nested tool settlement with {type,toolName,input,status,result?,error?}; hook tool calls do not retrigger hooks

checkpoint accepts one binding, no hook: named durable helpers snapshot(value) → portable current data, restore(data) → rebuilt value; both may be async. Restorers also run for profiles and isolated cells, so reconnecting resources can have external effects. Failed restoration blocks execution and preserves the checkpoint; unpin the names reported for recovery

TS state is separate from Deno Notebook. Normal cells share live bindings, closures and module instances. Durable snapshots retain supported data and helper recipes, reporting skipped live-only values. Live errors can leave mutations; tool and file effects are not rolled back. Isolated cells use a checkpoint copy and save a candidate without changing live state. Loading a candidate replaces the kernel and discards current live-only values and unsaved changes`;

const NOTEBOOK_GPT_HELP = `Native {"input":"<JSON action object>"}; nested tools.notebook({action,...})
status query?:string→memory/checkpoint/state; query→live matches
list query?:string→saved profiles/isolated candidates; name filter
checkpoint→persist serializable state
save name:string→named profile
load name:string→add profile/candidate by value; NO replay; release/rename collisions FIRST; NEVER replace live kernel
pin names:string[] hook?:"startup"|"tool_result"|false→durable project bindings, release/prune protected; omit hook→keep, false→remove
unpin names:string[]→remove protection/hooks; keep bindings
release names:string[]→dispose/remove unpinned bindings; protected→unpin FIRST
prune query:string→release unpinned glob matches; pins survive
restart→stop active cell; restore last completed checkpoint
diagnostics→historical cells/runtime health; NO execution
reset→stop cell; discard session checkpoint; keep durable project state/saved notebook/named profiles
query: case-insensitive * and ? globs; prune nonempty. names: nonempty binding-name array; pin/release→existing JS identifiers. Profile names: 1-64 letters/numbers/._-; first alphanumeric
Hooks=self-contained awaited fn(event); recreate imports/live handles inside. startup→{type:"startup"} once/fresh restored kernel, NOT on pin; NO Pi tools; failure blocks execution, unpin available. tool_result→{type:"tool_result",toolName,input,status:"success"|"error",result?,error?} AFTER nested tools settle; awaited in name order; hook tools NEVER retrigger
Management AFTER exec; inside exec ONLY: status(no query), list, diagnostics. release/prune MAY restart lexical-binding kernel, losing runtime-only handles
Normal: 1 active cell. isolated:true→separate Deno kernel from committed state, max4; wait→continue/terminate. Completion→named candidate; NEVER auto-adopt; list→explicit additive load. Transfer ONLY checkpoint-supported state, NOT arbitrary closures/types/imports. External tool/file effects NEVER roll back`;

const TS_GPT_HELP = `Native {"input":"<JSON action object>"}; nested tools.notebook({action,...})
status query?:string→live bindings/active cells
list query?:string→profiles/isolated candidates
checkpoint→durable snapshot; report live-only values
save name:string→durable profile
load name:string→add profile by value; release collisions FIRST. candidate-*→REPLACE live kernel; live-only values/unsaved changes LOST
pin names:string[] hook?:"startup"|"tool_result"|false checkpoint?:{snapshot:string,restore:string}→durable bindings, release/prune protected; omit hook→keep, false→remove
unpin names:string[]→remove protection/hooks/checkpoint registration; keep live bindings
release names:string[]→remove unpinned bindings
prune query:string→remove unpinned glob matches
restart→last durable checkpoint; live-only values/later changes LOST
diagnostics→state/runtime health
reset→discard session state; project pins/named profiles survive
query: case-insensitive * and ? globs. Lifecycle changes/save/checkpoint→IDLE cells. Inside exec ONLY: status(no query), list, diagnostics. Release/prune rebuild kernel→reusable names; live-only values LOST
Hooks=self-contained fn(event). startup→once/fresh restored kernel including isolated workers, NOT on pin; NO Pi tools. tool_result→AFTER nested tools settle: {type,toolName,input,status,result?,error?}; hook tools NEVER retrigger
checkpoint registration: ONE binding, NO hook; named durable helpers snapshot(value)→portable current data, restore(data)→rebuilt value; either async. Restorers ALSO for profiles/isolated cells; reconnect MAY cause external effects. Restore failure→block execution, preserve checkpoint; recovery→unpin reported names
TS state≠Deno. Normal cells share bindings/closures/modules. Snapshots retain supported data/helper recipes, report skipped live-only values. Live errors MAY leave mutations; tool/file effects NEVER roll back. Isolated cells→checkpoint copy→saved candidate; live state unchanged UNTIL explicit candidate load REPLACES kernel`;

export function notebookHelpForMode(kind: string, gpt: boolean): string {
	if (kind !== "notebook" && kind !== "ts") throw new Error("Notebook controls require Notebook or TS mode.");
	if (gpt) return kind === "ts" ? TS_GPT_HELP : NOTEBOOK_GPT_HELP;
	return kind === "ts" ? TS_HELP : NOTEBOOK_HELP;
}
