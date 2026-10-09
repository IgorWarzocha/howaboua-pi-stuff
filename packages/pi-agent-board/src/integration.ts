import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BoardBinding } from "./identity.js";
import type { BoardEnvelope } from "./protocol.js";

/** Optional membership transport. The runtime owns storage, settings and delivery. */
export interface BoardAdapter {
	briefing?(
		member: boolean,
		population: "empty" | "populated" | "unavailable",
	): string;
	request(
		route: string,
		request: BoardEnvelope,
		signal?: AbortSignal,
	): Promise<unknown>;
	commitDirectory(
		own: BoardBinding,
		directory: BoardBinding[],
		caller: BoardBinding,
		request: Extract<
			BoardEnvelope,
			{ operation: "board-register" | "board-unregister" }
		>,
	): unknown;
	routeNotice(
		ctx: ExtensionContext,
		request: Extract<BoardEnvelope, { operation: "board-notify" }>,
		signal?: AbortSignal,
	): Promise<unknown>;
	propagateEnabled(ctx: ExtensionContext, enabled: boolean): Promise<void>;
}

export type { BoardScope } from "./config.js";
export {
	contextBriefingWindow,
	hasContextRollover,
	recordContextBriefing,
	registerContextBriefing,
} from "./context-briefing.js";
export type { BoardBinding } from "./identity.js";
export {
	BindingSchema,
	binding,
	children,
	members,
	parseBinding,
	removeMember,
	saveBinding,
	saveChild,
	saveMember,
} from "./identity.js";
export type { BoardEnvelope } from "./protocol.js";
export { isBoardEnvelope } from "./protocol.js";
