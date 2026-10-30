import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodeModeToolProvider, OpaqueContextGuard } from "./shared-runtime.ts";
import type { RuntimeResponse } from "./types.ts";

export class OpaqueResultState {
	private opaqueGeneration = 0;
	// Completed status only. Protected contents live in persisted host events, never a second delivery queue.
	private readonly completedCells = new Map<string, { response: RuntimeResponse; owner: string }>();

	private readonly activeProviders: (ctx: ExtensionContext) => CodeModeToolProvider[];
	private readonly owner: (ctx: ExtensionContext) => string;

	constructor(activeProviders: (ctx: ExtensionContext) => CodeModeToolProvider[], owner: (ctx: ExtensionContext) => string) {
		this.activeProviders = activeProviders;
		this.owner = owner;
	}

	async opaqueContextGuard(ctx: ExtensionContext): Promise<OpaqueContextGuard> {
		const generation = this.opaqueGeneration;
		const baseOwner = this.owner(ctx);
		const providers = this.activeProviders(ctx).filter(provider => provider.opaqueResultScope);
		const provider = providers[0];
		if (providers.length !== 1 || !provider?.opaqueResultScope || !provider.deliverOpaqueResponse)
			throw new Error("Remote context authentication is unavailable or conflicting");
		const resolver = provider.opaqueResultScope;
		const deliver = provider.deliverOpaqueResponse;
		const resolveScope = () => resolver.call(provider, ctx);
		const lazy = provider.lazyOpaqueResultScope?.() === true;
		let backendScope = lazy ? undefined : await resolveScope();
		// Lazy cells use host identity for admission; only authenticated backend scope is persisted.
		const scope = backendScope ?? JSON.stringify({ hostContext: baseOwner, generation });
		const unchanged = () => generation === this.opaqueGeneration && baseOwner === this.owner(ctx) &&
			this.activeProviders(ctx).includes(provider);
		if (!unchanged()) throw new Error("Remote context changed during authentication; start a new exec cell");
		const authenticate = async () => {
			const latest = await resolveScope();
			if (!unchanged() || (backendScope !== undefined && latest !== backendScope))
				throw new Error("Remote context changed; start a new exec cell");
			backendScope = latest;
			return latest;
		};
		return { scope, generation, lazy, get owner() { return JSON.stringify([baseOwner, backendScope ?? scope]); },
			resolveScope: authenticate,
			deliver: (response, callId) => {
				if (!unchanged()) throw new Error("Remote context changed after execution; check completed results before retrying");
				if (!backendScope) throw new Error("Protected delivery is not authenticated");
				return deliver.call(provider, response, callId, backendScope, ctx);
			}, valid: async () => {
			if (!unchanged()) return false;
			if (backendScope === undefined) return true;
			const latest = await resolveScope();
			return unchanged() && latest === backendScope;
		} };
	}

	deliverOpaqueResponse(response: RuntimeResponse, callId: string, guard?: OpaqueContextGuard): RuntimeResponse {
		const hasDelivery = Boolean(response.opaqueOutputs?.length);
		if (hasDelivery && !guard)
			throw new Error("Remote delivery is unavailable after execution; check completed results before retrying");
		const opaqueDeliveryId = hasDelivery && guard ? guard.deliver(response, callId) : undefined;
		if (guard && (!guard.lazy || hasDelivery) && response.kind !== "yielded" && !response.missingCell) {
			this.completedCells.delete(response.cellId);
			const oldest = this.completedCells.keys().next().value;
			if (this.completedCells.size >= 32 && oldest !== undefined) this.completedCells.delete(oldest);
			this.completedCells.set(response.cellId, { owner: guard.owner,
				response: { kind: response.kind, cellId: response.cellId, contentItems: [{ type: "input_text",
					text: "Execution already complete; termination does not undo completed operations" }],
					...(response.kind === "result" && response.errorText ? { errorText: response.errorText.slice(0, 4096) } : {}) } });
		}
		if (!hasDelivery) return response;
		const { opaqueOutputs: _outputs, opaqueScope: _scope, originalExecCallId: _origin, ...receipt } = response;
		return { ...receipt, opaqueDeliveryId, contentItems: response.contentItems.filter(item => item.type !== "input_image") };
	}

	async completedCell(cellId: string, ctx: ExtensionContext): Promise<RuntimeResponse | undefined> {
		const entry = this.completedCells.get(cellId);
		if (!entry) return undefined;
		const guard = await this.opaqueContextGuard(ctx);
		if (guard.lazy) await guard.resolveScope();
		if (this.completedCells.get(cellId) !== entry || entry.owner !== guard.owner) {
			if (this.completedCells.get(cellId) === entry) this.completedCells.delete(cellId);
			throw new Error("Remote context changed after execution; check completed results before retrying");
		}
		return entry.response;
	}

	clear(): void {
		this.opaqueGeneration++;
		this.completedCells.clear();
	}
}
