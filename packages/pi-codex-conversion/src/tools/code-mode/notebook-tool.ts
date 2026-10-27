import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { registerGptPromptMode, type GptPromptModeRegistration } from "../../prompt-mode.ts";
import { getExperimentalToolSampling } from "../tool-sampling.ts";
import { canExecuteNotebookControlInsideExec } from "../notebook-mode/control-contract.ts";
import type { SharedCodeModeRuntime } from "./shared-runtime.ts";
import { notebookRenderers } from "./notebook-rendering.ts";
import type {
	NotebookControlRequest,
	NotebookControlResult,
	ProgrammaticCodeModeToolDefinition,
	ToolExecutionContext,
} from "./types.ts";

const PIN_PARAMETERS = Type.Object({
	action: Type.Literal("pin"),
	names: Type.Array(Type.String(), { minItems: 1 }),
	hook: Type.Optional(Type.Union([StringEnum(["startup", "tool_result"]), Type.Literal(false)], {
		description: "Await self-contained fn(event); tool_result gets {type,toolName,input,status,result?,error?}; hook tool calls do not retrigger; false removes hook",
	})),
}, { additionalProperties: false });

function notebookActionParameters(allowCheckpoint = false) {
	return Type.Union([
		Type.Object({
			action: StringEnum(["status", "list"]),
			query: Type.Optional(Type.String()),
		}, { additionalProperties: false }),
		Type.Object({
			action: StringEnum(["checkpoint", "restart", "diagnostics", "reset"]),
		}, { additionalProperties: false }),
		Type.Object({
			action: StringEnum(["save", "load"]),
			name: Type.String(),
		}, { additionalProperties: false }),
		allowCheckpoint ? Type.Object({ ...PIN_PARAMETERS.properties, checkpoint: Type.Optional(Type.Object({ snapshot: Type.String(), restore: Type.String() }, { additionalProperties: false })) }, { additionalProperties: false }) : PIN_PARAMETERS,
		Type.Object({
			action: StringEnum(["unpin", "release"]),
			names: Type.Array(Type.String(), { minItems: 1 }),
		}, { additionalProperties: false }),
		Type.Object({
			action: Type.Literal("prune"),
			query: Type.String(),
		}, { additionalProperties: false }),
	]);
}

const JS_ACTION_PARAMETERS = Type.Union([
	Type.Object({ action: Type.Literal("hook"), name: Type.String(), event: Type.Union([StringEnum(["startup", "tool_result"]), Type.Literal(false)]) }, { additionalProperties: false }),
	Type.Object({ action: StringEnum(["status", "list"]), query: Type.Optional(Type.String()) }, { additionalProperties: false }),
	Type.Object({ action: StringEnum(["checkpoint", "restart", "diagnostics", "reset"]) }, { additionalProperties: false }),
	Type.Object({ action: Type.Literal("save"), name: Type.String(), names: Type.Optional(Type.Array(Type.String(), { minItems: 1 })) }, { additionalProperties: false }),
	Type.Object({ action: Type.Literal("load"), name: Type.String() }, { additionalProperties: false }),
	Type.Object({ action: StringEnum(["pin", "unpin", "release"]), names: Type.Array(Type.String(), { minItems: 1 }) }, { additionalProperties: false }),
	Type.Object({ action: Type.Literal("prune"), query: Type.String() }, { additionalProperties: false }),
]);

const JS_HELP = `Actions use {"input":"<JSON action object>"}.
{"action":"status","query"?:string}  Inspect retained binding names, kinds and types; query filters with * and ? globs
{"action":"diagnostics"}  Inspect runtime health
{"action":"hook","name":string,"event":"startup"|"tool_result"|false}  Register an existing function or remove its registration
{"action":"checkpoint"}  Save the entire VM state
{"action":"save","name":string,"names"?:string[]}  Save selected data, or omit names for a whole-notebook profile without project pin registrations
{"action":"load","name":string}  Add selected data by value; a whole-notebook profile or isolated candidate REPLACES the live state
{"action":"pin","names":string[]}  Protect plain-data bindings from release/prune and preserve them through reset
{"action":"unpin","names":string[]}  Remove project pins, keeping live bindings
{"action":"release","names":string[]}  Remove unprotected bindings, including const; names become reusable
{"action":"prune","query":string}  Release bindings matching an explicit glob; pins and registered hooks survive
{"action":"list","query"?:string}  List JS profiles and isolated candidates
{"action":"restart"}  Stop active cells and restore the last checkpoint
{"action":"reset"}  Reset the SHARED project notebook; pins and named profiles survive

Conversations in the same Git project share the complete notebook, including hooks; outside Git, scope is the working folder. Normal cells serialize across conversations and refresh from the latest checkpoint. Failed cells may leave local live mutations; conflicting shared updates preserve a recovery profile instead of overwriting them. Cancellation stops that execution kernel; restart restores shared state, not external tool effects. Await all host calls. isolated:true saves a snapshot candidate; changed-base adoption requires explicit replacement. JS storage is separate from other modes.
Selective profiles and pins support primitives, mutable plain objects and arrays with aliases/cycles, not functions, classes, accessors or proxies. Unsupported pins leave the whole checkpoint intact and report failed reset-survival sync. Data loads reject name collisions. Release preserves aliases and captured values in surviving closures, so redeclaring a released name does not retarget them. Unreferenced values can be reclaimed; older native-scope images report any roots still retained.
Hooks persist across project conversations and full profiles. startup runs once per fresh execution kernel before its first user cell, without Pi tools; failure blocks user code until removal or restart. tool_result receives {type,toolName,input,status,result?,error?} after nested tools settle; hooks run in name order, awaited, without recursive triggering. Hook failures fail the cell and preserve live state. Registration does not run hooks.
Run state-changing controls after exec returns. Inside exec, tools.notebook({action:"status"}) without query, list and diagnostics are available.`;

function actionParameters(kind: string) {
	return kind === "js" ? JS_ACTION_PARAMETERS : kind === "ts" ? TS_ACTION_PARAMETERS : NOTEBOOK_ACTION_PARAMETERS;
}

const NOTEBOOK_ACTION_PARAMETERS = notebookActionParameters();
const TS_ACTION_PARAMETERS = notebookActionParameters(true);

export const NOTEBOOK_PARAMETERS = Type.Object({
	input: Type.Optional(Type.String({ description: 'help or JSON, e.g. {"action":"status"}; not a bare action name' })),
}, { additionalProperties: false });

const NOTEBOOK_DISCOVERY_PARAMETERS = Type.Object({
	action: Type.Optional(Type.Literal("help")),
}, { additionalProperties: false });

const NOTEBOOK_DESCRIPTION = "Manage persistent notebook state";

const NOTEBOOK_HELP = `Actions use {"input":"<JSON action object>"}.
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

query uses case-insensitive * and ? globs. prune requires a nonempty query. names must be a nonempty array of binding-name strings. pin/release require existing JavaScript identifiers. Profile names: 1-64 letters, numbers, dots, underscores or hyphens, starting with a letter or number.

Hooks must be self-contained fn(event), awaited when invoked. startup gets {type:"startup"} once per fresh kernel after restoration, not when pinned; Pi tools cannot run during startup. tool_result gets {type:"tool_result",toolName,input,status:"success"|"error",result?,error?} after nested tool settlement; handlers are awaited in name order and their tool calls do not retrigger hooks. Recreate imports and live handles inside the function. Startup failures block execution; unpin remains available. External side effects are not rolled back.

Run management calls after exec returns. Inside exec, tools.notebook({action,...}) supports status without query, list and diagnostics only. release/prune may restart the kernel for lexical bindings, clearing runtime-only handles.

Normal cells allow one active execution. isolated:true runs a separate Deno kernel from committed saved state, up to four isolated cells at once. Use wait to continue or terminate that isolated cell. Completion saves a named candidate without changing live state. list exposes candidates; load explicitly adds their saved bindings by value and rejects collisions, so release or rename colliding bindings first. Candidates never auto-adopt or replace the live kernel. Only checkpoint-supported state transfers, not arbitrary closures, types or imports. Tool and file effects are not rolled back.`;

const TS_HELP = `Actions use {"input":"<JSON action object>"}.
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

query uses case-insensitive * and ? globs. Lifecycle changes, save and checkpoint require idle cells. Inside exec, tools.notebook({action:"status"}), list and diagnostics are available. Release/prune rebuild the kernel so names are reusable; live-only values are discarded.

Hooks use self-contained fn(event). startup runs once per fresh kernel, including isolated workers, after restoration, not when pinned; Pi tools are unavailable during startup. tool_result runs after nested tool settlement with {type,toolName,input,status,result?,error?}; hook tool calls do not retrigger hooks.

checkpoint accepts one binding, no hook: named durable helpers snapshot(value) → portable current data, restore(data) → rebuilt value; both may be async. Restorers also run for profiles and isolated cells, so reconnecting resources can have external effects. Failed restoration blocks execution and preserves the checkpoint; unpin the names reported for recovery.

TS state is separate from Deno Notebook. Normal cells share live bindings, closures and module instances. Durable snapshots retain supported data and helper recipes, reporting skipped live-only values. Live errors can leave mutations; tool and file effects are not rolled back. Isolated cells use a checkpoint copy and save a candidate without changing live state. Loading a candidate replaces the kernel and discards current live-only values and unsaved changes.`;

const NOTEBOOK_GPT_HELP = `Native: {"input":"<JSON action object>"}; nested: tools.notebook({action,...})
status query?:string→memory/checkpoint/retainedsummary; query→inspectlivematches
list query?:string→savedprofiles/isolatedcandidates; namefilter
checkpoint→persistserializablestate
save name:string→namedstateprofile
load name:string→addprofile/candidateBYVALUE; NOcellreplay; release/renamecollisionsFIRST; NEVERreplacelivekernel
pin names:string[] hook?:"startup"|"tool_result"|false→durableprojectbindings; release/pruneprotection; omittedhook→preserve, false→remove
unpin names:string[]→removeprotection/hooks; keepbindings
release names:string[]→dispose/removeunpinnedbindings; protected→unpinFIRST
prune query:string→releaseunpinnedglobmatches; pinssurvive
restart→stopactivecell; restorelastcompletedcheckpoint
diagnostics→historicalcells/runtimehealth; NOexecution
reset→stopactivecell; discardsessioncheckpoint; durableprojectstate/savednotebook/namedprofilessurvive
query: case-insensitive * and ? globs; prune→nonempty. names: nonemptybindingnamearray; pin/release→existingJSidentifiers. Profilenames: 1-64 letters/numbers/._-; firstalphanumeric
Hooks=selfcontainedAWAITED fn(event); recreateimports/livehandlesINSIDE. startup→{type:"startup"} once/freshrestoredkernel, NOTonpin; NOPitools; failure→blockexecution, unpinAVAILABLE. tool_result→{type:"tool_result",toolName,input,status:"success"|"error",result?,error?} AFTERnestedtoolssettle; awaitinnameorder; hooktoolsNEVERretrigger
ManagementAFTERexec; insideexecONLY: status(noquery), list, diagnostics. release/pruneMAYrestartlexicalbindingkernel→runtime-onlyhandlesLOST
Normal→1activecell. isolated:true→separateDenokernelfromcommittedsavedstate, max4; wait→continue/terminateisolatedcell. Completion→namedcandidate, NEVERautoadopt; list→explicitadditiveload, rejectcollisions. TransferONLYcheckpoint-supportedstate, NOTarbitraryclosures/types/imports. Externaltool/fileeffectsNEVERrollback`;

const TS_GPT_HELP = `Native: {"input":"<JSON action object>"}; nested: tools.notebook({action,...})
status query?:string→livebindings/activecells
list query?:string→profiles/isolatedcandidates
checkpoint→durablesnapshot; reportunsavedlive-onlyvalues
save name:string→nameddurableprofile
load name:string→addprofileBYVALUE; releasecollisionsFIRST. candidate-*→REPLACElivekernel; live-onlyvalues/unsavedchangesLOST
pin names:string[] hook?:"startup"|"tool_result"|false checkpoint?:{snapshot:string,restore:string}→durableretainedbindings; release/pruneprotection; omittedhook→preserve, false→remove
unpin names:string[]→removeprotection/hooks/checkpointregistration; keeplivebindings
release names:string[]→removeunpinnedbindings
prune query:string→removeunpinnedglobmatches
restart→lastdurablecheckpoint; live-onlyvalues/laterchangesLOST
diagnostics→state/runtimehealth
reset→discardsessionstate; projectpins/namedprofilessurvive
query: case-insensitive * and ? globs. Lifecyclechanges/save/checkpoint→IDLEcells. InsideexecONLY: status(noquery), list, diagnostics. Release/prune→rebuildkernel→namesreusable, live-onlyvaluesLOST
Hooks=selfcontained fn(event). startup→once/freshrestoredkernelINCLisolatedworkers, NOTonpin; NOPitools. tool_result→AFTERnestedtoolssettle: {type,toolName,input,status,result?,error?}; hooktoolsNEVERretrigger
checkpointregistration: ONEbinding, NOhook; nameddurablehelpers snapshot(value)→portableCURRENTdata, restore(data)→rebuiltvalue; eitherasync. RestorersALSOforprofiles/isolatedcells; reconnectMAYcauseexternaleffects. Restorefailure→blockexecution, preservecheckpoint; recovery→unpinreportednames
TSstate≠Deno. Normalcells→sharedlivebindings/closures/modules. Snapshots→supporteddata/helperrecipes; reportskippedlive-onlyvalues. LiveerrorsMAYleavemutations; tool/fileeffectsNEVERrollback. Isolatedcells→checkpointcopy→savedcandidate; livestateUNCHANGEDuntilexplicitcandidateloadREPLACESkernel`;

const JS_GPT_HELP = `Native: {"input":"<JSON action object>"}; nested: tools.notebook({action,...})
status query?:string→retainedbindingnames/kinds/types; * and ? globfilter
diagnostics→runtimehealth
hook name:string event:"startup"|"tool_result"|false→registerexistingfunction/removeregistration
checkpoint→ENTIREVMstate
save name:string names?:string[]→selecteddata; omitnames→whole-notebookprofileWITHOUTprojectpinregistrations
load name:string→addselecteddataBYVALUE; whole-notebookprofile/isolatedcandidate→REPLACElivestate
pin names:string[]→plaindatarelease/pruneprotection+resetsurvival
unpin names:string[]→removeprojectpins; keeplivebindings
release names:string[]→removeunprotectedbindingsINCLconst; namesreusable
prune query:string→explicitglobrelease; pins/registeredhookssurvive
list query?:string→JSprofiles/isolatedcandidates
restart→stopactivecells; restorelastcheckpoint
reset→resetSHAREDprojectnotebook; pins/namedprofilessurvive
SameGitproject→sharedCOMPLETE notebook/hooksacrossconversations; outsideGit→workingfolderscope. Normalcells→serialacrossconversations+refreshlatestcheckpoint. FailedcellsMAYleavelivemutations; sharedconflict→recoveryprofileNOToverwrite. Cancel→stopexecutionkernel; restart→restoresharedstate≠externaltoolrollback. AwaitALLhostcalls. isolated:true→snapshotcandidate; changedbaseadoption→EXPLICITreplacement. JSstorage≠othermodes
Selectiveprofiles/pins: primitives/mutableplainobjects/arrays+aliases/cycles; NOfunctions/classes/accessors/proxies. Unsupportedpins→preservewholecheckpoint+reportfailedreset-survivalsync. Dataloads→rejectcollisions. Release→preservealiases/capturedclosurevalues; redeclarationNEVERretargets. Unreferencedvalues→reclaimable; oldernative-scopeimages→reportretainedroots
Hooks→persistacrossprojectconversations/fullprofiles. startup→once/freshkernelBEFOREfirstusercell; NOPitools; failure→blockusercodeUNTILremoval/restart. tool_result→AFTERnestedtoolssettle: {type,toolName,input,status,result?,error?}; awaitinnameorder; NOrecursivetrigger. Hookfailure→failcell, preservelivestate. Registration≠invocation
StatechangingcontrolsAFTERexec; insideexecONLY: status(noquery), list, diagnostics`;

const notebookPromptModes = new WeakMap<SharedCodeModeRuntime, GptPromptModeRegistration>();

function notebookHelp(runtime: SharedCodeModeRuntime, context: unknown): string {
	const kind = runtime.executionKind(context);
	if (notebookPromptModes.get(runtime)?.active)
		return kind === "js" ? JS_GPT_HELP : kind === "ts" ? TS_GPT_HELP : NOTEBOOK_GPT_HELP;
	return kind === "js" ? JS_HELP : kind === "ts" ? TS_HELP : NOTEBOOK_HELP;
}

type NotebookToolParameters = {
	action: string;
	query?: string | undefined;
	name?: string | undefined;
	names?: string[] | undefined;
	hook?: string | false | undefined;
	event?: string | false | undefined;
	checkpoint?: { snapshot: string; restore: string } | undefined;
};

export function registerNotebookTool(pi: ExtensionAPI, runtime: SharedCodeModeRuntime): void {
	notebookPromptModes.set(runtime, registerGptPromptMode(pi, () => undefined));
	const constrainedSampling = getExperimentalToolSampling("notebook");
	pi.registerTool({
		name: "notebook",
		defaultActive: false,
		exposure: "model-only",
		executionMode: "sequential",
		label: "Notebook",
		description: "Manage persistent notebook state",
		parameters: NOTEBOOK_PARAMETERS,
		...notebookRenderers,
		...(constrainedSampling ? { constrainedSampling } : {}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (params.input === undefined || params.input === "help") return {
				content: [{ type: "text", text: notebookHelp(runtime, ctx) }],
				details: { action: "help" },
			};
			let action: unknown;
			try {
				action = JSON.parse(params.input);
			} catch (error) {
				throw new Error('notebook input must be help or a JSON action object; call notebook({})', { cause: error });
			}
			if (!Check(actionParameters(runtime.executionKind(ctx)), action)) {
				throw new Error('Invalid notebook action arguments; call notebook({})');
			}
			const result = await executeNotebookControl(runtime, action, {
				cwd: ctx.cwd,
				extensionContext: ctx,
			}, signal);
			return {
				content: [{ type: "text", text: result.message }],
				details: result.details,
			};
		},
	} satisfies ToolDefinition<typeof NOTEBOOK_PARAMETERS>);
}

export function createNotebookControlProxy(
	runtime: SharedCodeModeRuntime,
	kind: "code" | "notebook" | "ts" | "js" = "notebook",
): ProgrammaticCodeModeToolDefinition {
	return {
		name: "notebook",
		usage: "await tools.notebook()",
		discovery: "help",
		description: NOTEBOOK_DESCRIPTION,
		deferLoading: true,
		kind: "function",
		inputSchema: Type.Union([NOTEBOOK_DISCOVERY_PARAMETERS, actionParameters(kind)]),
		invoke: (input, context, signal) => {
			if (input === undefined || Check(NOTEBOOK_DISCOVERY_PARAMETERS, input))
				return Promise.resolve({ message: notebookHelp(runtime, context.extensionContext), details: { action: "help" } });
			return executeNotebookExecControl(runtime, input as NotebookToolParameters, context, signal);
		},
	};
}

export async function executeNotebookControl(
	runtime: SharedCodeModeRuntime,
	params: NotebookToolParameters,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	validateModeRequest(runtime, params, context);
	return executeNormalizedNotebookControl(runtime, normalizeNotebookRequest(params, runtime.executionKind(context.extensionContext) === "ts", runtime.executionKind(context.extensionContext) === "js"), context, signal);
}

export async function executeNotebookExecControl(
	runtime: SharedCodeModeRuntime,
	params: NotebookToolParameters,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	validateModeRequest(runtime, params, context);
	const request = normalizeNotebookRequest(params, runtime.executionKind(context.extensionContext) === "ts", runtime.executionKind(context.extensionContext) === "js");
	if (!canExecuteNotebookControlInsideExec(request))
		return {
			message: `Notebook ${request.action} was not run because it needs the active exec cell to finish. After exec returns, call notebook with ${JSON.stringify({ input: JSON.stringify(request) })}.`,
			details: { notRun: true, action: request.action, retry: request },
		};
	return executeNormalizedNotebookControl(runtime, request, context, signal);
}

function validateModeRequest(runtime: SharedCodeModeRuntime, params: NotebookToolParameters, context: ToolExecutionContext): void {
	if (runtime.executionKind(context.extensionContext) === "js" && !Check(JS_ACTION_PARAMETERS, params))
		throw new Error("Invalid JS Notebook action; call notebook({}) for supported controls");
}

function executeNormalizedNotebookControl(
	runtime: SharedCodeModeRuntime,
	request: NotebookControlRequest,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	return runtime.controlNotebook(request, context, signal);
}

export function normalizeNotebookRequest(params: NotebookToolParameters, allowCheckpoint = false, allowSelectedData = false): NotebookControlRequest {
	params = {
		action: params.action,
		...(params.query == null ? {} : { query: params.query }),
		...(params.name == null ? {} : { name: params.name }),
		...(params.names == null ? {} : { names: params.names }),
		...(params.hook == null ? {} : { hook: params.hook }),
		...(params.event === undefined ? {} : { event: params.event }),
		...(params.checkpoint === undefined ? {} : { checkpoint: params.checkpoint }),
	};
	if (params.action === "hook") {
		if (!params.name || params.query !== undefined || params.names !== undefined || params.hook !== undefined || params.checkpoint !== undefined || params.event !== false && params.event !== "startup" && params.event !== "tool_result") throw new Error("notebook hook requires name and event: startup, tool_result, or false");
		return { action: "hook", name: params.name, event: params.event };
	}
	if (params.event !== undefined) throw new Error("event requires notebook hook");
	if (params.checkpoint !== undefined && (!allowCheckpoint || params.action !== "pin" || params.names?.length !== 1 || params.hook !== undefined || !params.checkpoint || typeof params.checkpoint.snapshot !== "string" || typeof params.checkpoint.restore !== "string")) throw new Error("TS checkpoint requires pin, one binding, named snapshot and restore helpers, and no hook");
	if (params.hook !== undefined && (params.action !== "pin" || params.hook !== false && params.hook !== "startup" && params.hook !== "tool_result")) {
		throw new Error("notebook hook requires pin and startup, tool_result, or false");
	}
	if (params.action === "status" || params.action === "list") {
		if (params.name !== undefined || params.names !== undefined) throw new Error(`notebook ${params.action} accepts query only`);
		return { action: params.action, ...(params.query === undefined ? {} : { query: params.query }) };
	}
	if (params.action === "save" || params.action === "load") {
		if (allowSelectedData && params.action === "save" && params.names !== undefined) {
			if (!params.name || !params.names.length || params.query !== undefined) throw new Error("Selective JS save requires name and nonempty names");
			return { action: "save", name: params.name, names: [...new Set(params.names)] };
		}
		if (params.query !== undefined || params.names !== undefined) throw new Error(`notebook ${params.action} accepts name only`);
		if (!params.name) throw new Error(`notebook ${params.action} requires name`);
		return { action: params.action, name: params.name };
	}
	if (params.action === "release" || params.action === "pin" || params.action === "unpin") {
		if (params.query !== undefined || params.name !== undefined) throw new Error(`notebook ${params.action} accepts names only`);
		if (!params.names?.length) throw new Error(`notebook ${params.action} requires at least one name`);
		return { action: params.action, names: [...new Set(params.names)], ...(params.action === "pin" && params.hook !== undefined ? { hook: params.hook } : {}), ...(params.action === "pin" && params.checkpoint ? { checkpoint: params.checkpoint } : {}) };
	}
	if (params.action === "prune") {
		if (params.name !== undefined || params.names !== undefined) throw new Error("notebook prune accepts query only");
		if (!params.query) throw new Error("notebook prune requires query");
		return { action: "prune", query: params.query };
	}
	if (params.action !== "checkpoint" && params.action !== "restart" && params.action !== "diagnostics" && params.action !== "reset") {
		throw new Error(`Unsupported notebook action: ${params.action}`);
	}
	if (params.query !== undefined || params.name !== undefined || params.names !== undefined) {
		throw new Error(`notebook ${params.action} accepts only action`);
	}
	return { action: params.action };
}
