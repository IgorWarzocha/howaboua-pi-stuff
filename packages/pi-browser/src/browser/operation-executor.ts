import {
	clickCoordinates,
	clickRef,
	clickSelector,
} from "../cdp/actions/click.js";
import {
	html,
	htmlRef,
	loadAll,
	navigate,
	networkEntries,
	rawCommand,
} from "../cdp/actions/page.js";
import {
	captureRef,
	captureSelector,
	captureViewport,
} from "../cdp/actions/screenshot.js";
import { typeAtFocus, typeRef } from "../cdp/actions/type.js";
import { evaluateText } from "../cdp/evaluate.js";
import { type ActiveTab, BrowserCdpSession } from "../cdp/session.js";
import { snapshotData } from "../cdp/snapshot.js";
import {
	discardCachedResult,
	limitedText,
	readCachedResult,
	screenshotPath,
} from "./artifacts.js";
import { boundSnapshot, boundTabs } from "./bounds.js";
import { startBrowser } from "./launcher.js";
import type { BrowserOperation } from "./operation.js";

export class BrowserOperationExecutor {
	private readonly cdp: BrowserCdpSession;

	constructor(cdp: BrowserCdpSession) {
		this.cdp = cdp;
	}

	async execute(
		operation: BrowserOperation,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		switch (operation.action) {
			case "start":
				return { result: await startBrowser(signal) };
			case "tabs":
				return boundTabs(
					await this.cdp.pages(signal),
					operation.query,
					operation.offset,
				);
			case "open":
				if ("url" in operation) {
					const opened = await this.cdp.open(operation.url, signal);
					return {
						ref_id: opened.refId,
						url: operation.url,
					};
				}
				return this.cdp.withTab(operation.ref_id, signal, async (tab) =>
					boundSnapshot(
						await snapshotData(tab.cdp, tab.sessionId, tab.elementRefs, {
							refId: tab.refId,
							lineno: operation.lineno,
							responseLength: operation.response_length,
							signal,
						}),
					),
				);
			case "find":
				return this.cdp.withTab(operation.ref_id, signal, async (tab) =>
					boundSnapshot(
						await snapshotData(tab.cdp, tab.sessionId, tab.elementRefs, {
							refId: tab.refId,
							pattern: operation.pattern,
							lineno: operation.lineno,
							responseLength: operation.response_length,
							signal,
						}),
					),
				);
			case "read_result":
				return readCachedResult(operation);
			case "discard_result":
				return discardCachedResult(operation.handle);
			case "stop":
				await this.cdp.stop(operation.ref_id);
				return {
					stopped: operation.ref_id ?? "all tab daemons",
				};
			case "screenshot":
				return this.screenshot(operation, signal);
			case "evaluate":
				return this.cdp.withTab(operation.ref_id, signal, async (tab) =>
					limitedText(
						{ ref_id: tab.refId },
						"value",
						await evaluateText(
							tab.cdp,
							tab.sessionId,
							operation.expression,
							signal,
						),
					),
				);
			case "html":
				return this.cdp.withTab(operation.ref_id, signal, async (tab) =>
					limitedText(
						{ ref_id: tab.refId },
						"html",
						operation.id === undefined
							? await html(tab.cdp, tab.sessionId, operation.selector, signal)
							: await htmlRef(
									tab.cdp,
									tab.sessionId,
									tab.elementRefs,
									operation.id,
									signal,
								),
					),
				);
			case "network":
				return this.cdp.withTab(operation.ref_id, signal, async (tab) =>
					limitedText(
						{ ref_id: tab.refId },
						"entries",
						await networkEntries(tab.cdp, tab.sessionId, signal),
					),
				);
			case "raw":
				return this.cdp.withTab(operation.ref_id, signal, async (tab) =>
					limitedText(
						{ ref_id: tab.refId },
						"result",
						await rawCommand(
							tab.cdp,
							tab.sessionId,
							operation.method,
							operation.params,
							signal,
						),
					),
				);
			case "navigate":
				return this.tabResult(operation.ref_id, signal, (tab) =>
					navigate(tab.cdp, tab.sessionId, operation.url, signal),
				);
			case "click":
				return this.tabResult(operation.ref_id, signal, (tab) => {
					if (operation.id !== undefined) {
						return clickRef(
							tab.cdp,
							tab.sessionId,
							tab.elementRefs,
							operation.id,
							signal,
						);
					}
					if (operation.selector) {
						return clickSelector(
							tab.cdp,
							tab.sessionId,
							operation.selector,
							signal,
						);
					}
					if (operation.x === undefined || operation.y === undefined) {
						throw new Error("click requires id, selector, or x+y");
					}
					return clickCoordinates(
						tab.cdp,
						tab.sessionId,
						operation.x,
						operation.y,
						signal,
					);
				});
			case "type":
				return this.tabResult(operation.ref_id, signal, (tab) =>
					operation.id === undefined
						? typeAtFocus(tab.cdp, tab.sessionId, operation.text, signal)
						: typeRef(
								tab.cdp,
								tab.sessionId,
								tab.elementRefs,
								operation.id,
								operation.text,
								signal,
							),
				);
			case "load_all":
				return this.tabResult(operation.ref_id, signal, (tab) =>
					loadAll(
						tab.cdp,
						tab.sessionId,
						operation.selector,
						operation.interval_ms,
						signal,
					),
				);
		}
	}

	private async screenshot(
		operation: Extract<BrowserOperation, { action: "screenshot" }>,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		const file = await screenshotPath(operation);
		return this.cdp.withTab(operation.ref_id, signal, async (tab) => {
			const capture =
				operation.id !== undefined
					? await captureRef(
							tab.cdp,
							tab.sessionId,
							tab.elementRefs,
							operation.id,
							file,
							signal,
						)
					: operation.selector
						? await captureSelector(
								tab.cdp,
								tab.sessionId,
								operation.selector,
								file,
								signal,
							)
						: await captureViewport(tab.cdp, tab.sessionId, file, signal);
			return {
				ref_id: tab.refId,
				...(operation.id === undefined ? {} : { id: operation.id }),
				...(operation.selector ? { selector: operation.selector } : {}),
				file: capture.file,
				dpr: capture.dpr,
				coordinates: "CSS pixels; screenshot pixels / DPR",
			};
		});
	}

	private async tabResult(
		refId: string,
		signal: AbortSignal | undefined,
		action: (tab: ActiveTab) => Promise<string>,
	): Promise<Record<string, unknown>> {
		return this.cdp.withTab(refId, signal, async (tab) => ({
			ref_id: tab.refId,
			result: (await action(tab)) || "ok",
		}));
	}
}
