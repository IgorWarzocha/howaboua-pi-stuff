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

Hooks are fn(event); dependencies MUST be restorable. startup runs once per fresh kernel, including isolated workers, after restoration, not when pinned; Pi tools are unavailable during startup. tool_result runs after nested tool settlement with {type,toolName,input,status,result?,error?}; hook tool calls do not retrigger hooks

checkpoint accepts one binding, no hook: named durable helpers snapshot(value) → portable current data, restore(data) → rebuilt value; both may be async. Restorers also run for profiles and isolated cells, so reconnecting resources can have external effects. Failed restoration blocks execution and preserves the checkpoint; unpin the names reported for recovery

Normal cells share live bindings, closures and module instances. Durable snapshots retain supported data and helper recipes, reporting skipped live-only values. Live errors can leave mutations; external effects, including tool and file effects, are not rolled back. Isolated cells use a checkpoint copy and save a candidate without changing live state. Loading a candidate replaces the kernel and discards current live-only values and unsaved changes`;

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
Hooks=fn(event); dependencies MUST be restorable. startup→once/fresh restored kernel including isolated workers, NOT on pin; NO Pi tools. tool_result→AFTER nested tools settle: {type,toolName,input,status,result?,error?}; hook tools NEVER retrigger
checkpoint registration: ONE binding, NO hook; named durable helpers snapshot(value)→portable current data, restore(data)→rebuilt value; either async. Restorers ALSO for profiles/isolated cells; reconnect can cause external effects. Restore failure→block execution, preserve checkpoint; recovery→unpin reported names
Normal cells share bindings/closures/modules. Snapshots retain supported data/helper recipes, report skipped live-only values. Live errors can leave mutations; external effects including tools/files NEVER roll back. Isolated cells→checkpoint copy→saved candidate; live state unchanged UNTIL explicit candidate load REPLACES kernel`;

export function notebookHelpForPromptMode(gpt: boolean): string {
	return gpt ? TS_GPT_HELP : TS_HELP;
}
