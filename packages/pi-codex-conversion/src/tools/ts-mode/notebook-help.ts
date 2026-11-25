export const NOTEBOOK_HELP = `Native {"input":"<JSON action object>"}; nested tools.notebook({action,...})
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
