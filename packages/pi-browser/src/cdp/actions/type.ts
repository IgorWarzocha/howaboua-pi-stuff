import { evaluate } from "../evaluate.js";
import type { CdpConnection, ElementRefs } from "../types.js";
import { asRecord } from "../types.js";
import {
	backendCenter,
	requireElementRef,
	withBackendObject,
} from "./element.js";

export async function typeAtFocus(
	cdp: CdpConnection,
	sessionId: string,
	text: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!text) throw new Error("text required");
	const focusState = asRecord(
		await evaluate(
			cdp,
			sessionId,
			`(() => {
				const el = document.activeElement;
				if (!el || el === document.body || el === document.documentElement)
					return { ok: false, error: 'No editable element is focused' };
				const tag = el.tagName;
				const inputTypes = new Set([
					'text', 'search', 'email', 'url', 'tel', 'password', 'number'
				]);
				const input = tag === 'INPUT' &&
					inputTypes.has((el.type || 'text').toLowerCase());
				const textarea = tag === 'TEXTAREA';
				const contentEditable = el.isContentEditable;
				const iframe = tag === 'IFRAME';
				if (!input && !textarea && !contentEditable && !iframe)
					return { ok: false, error: 'Focused <' + tag + '> is not editable' };
				if ((input || textarea) && (el.disabled || el.readOnly))
					return { ok: false, error: 'Focused <' + tag + '> is disabled or read-only' };
				return {
					ok: true,
					tag,
					iframe,
					inspectable: !iframe,
					before: input || textarea
						? el.value
						: contentEditable ? el.textContent : null
				};
			})()`,
			signal,
		),
		"focused element state",
	);
	if (focusState["ok"] !== true) {
		throw new Error(
			typeof focusState["error"] === "string"
				? focusState["error"]
				: "Focused element is not editable",
		);
	}
	await cdp.send("Input.insertText", { text }, sessionId, signal);
	const tag =
		typeof focusState["tag"] === "string" ? focusState["tag"] : "ELEMENT";
	if (focusState["inspectable"] !== true) {
		return `Sent ${text.length} characters to focused <${tag}>; cross-origin result is not inspectable`;
	}
	const after = asRecord(
		await evaluate(
			cdp,
			sessionId,
			`(() => {
				const el = document.activeElement;
				if (!el) return { focused: false, value: null };
				const tag = el.tagName;
				const value = tag === 'INPUT' || tag === 'TEXTAREA'
					? el.value
					: el.isContentEditable ? el.textContent : null;
				return { focused: true, tag, value };
			})()`,
			signal,
		),
		"focused element result",
	);
	if (after["focused"] !== true || after["tag"] !== tag) {
		throw new Error(
			"Focus changed while typing; input result could not be verified",
		);
	}
	if (after["value"] === focusState["before"]) {
		throw new Error(
			`Input.insertText completed but focused <${tag}> did not change`,
		);
	}
	return `Typed ${text.length} characters into focused <${tag}>`;
}

export async function typeRef(
	cdp: CdpConnection,
	sessionId: string,
	elementRefs: ElementRefs,
	id: number | string,
	text: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!text) throw new Error("text required");
	const ref = requireElementRef(elementRefs, id);
	await backendCenter(cdp, sessionId, ref.backendNodeId, true, signal);
	return withBackendObject(
		cdp,
		sessionId,
		ref.backendNodeId,
		async (objectId) => {
			const focused = asRecord(
				await cdp.send(
					"Runtime.callFunctionOn",
					{
						objectId,
						functionDeclaration: `function() {
							const tag = this.tagName;
							const inputTypes = new Set([
								'text', 'search', 'email', 'url', 'tel',
								'password', 'number'
							]);
							const input = tag === 'INPUT' &&
								inputTypes.has((this.type || 'text').toLowerCase());
							const textarea = tag === 'TEXTAREA';
							const contentEditable = this.isContentEditable;
							if (!input && !textarea && !contentEditable)
								return { ok: false, error: '<' + tag + '> is not editable' };
							if ((input || textarea) && (this.disabled || this.readOnly))
								return { ok: false, error: '<' + tag + '> is disabled or read-only' };
							this.focus({ preventScroll: true });
							const root = this.getRootNode();
							if (root.activeElement !== this &&
								this.ownerDocument.activeElement !== this)
								return { ok: false, error: 'Could not focus editable <' + tag + '>' };
							const before = input || textarea ? this.value : this.textContent;
							return { ok: true, tag, before };
						}`,
						returnByValue: true,
					},
					sessionId,
					signal,
				),
				"focus response",
			);
			const focusState = asRecord(
				asRecord(focused["result"], "focus result")["value"],
				"focus state",
			);
			if (focusState["ok"] !== true) {
				throw new Error(
					typeof focusState["error"] === "string"
						? focusState["error"]
						: "Element is not editable",
				);
			}
			const activeResponse = asRecord(
				await cdp.send(
					"Runtime.callFunctionOn",
					{
						objectId,
						functionDeclaration: `function() {
							const root = this.getRootNode();
							return root.activeElement === this ||
								this.ownerDocument.activeElement === this;
						}`,
						returnByValue: true,
					},
					sessionId,
					signal,
				),
				"active element response",
			);
			const activeResult = asRecord(
				activeResponse["result"],
				"active element result",
			);
			if (activeResult["value"] !== true) {
				throw new Error("Focus changed before typing; input was not sent");
			}
			await cdp.send("Input.insertText", { text }, sessionId, signal);
			const afterResponse = asRecord(
				await cdp.send(
					"Runtime.callFunctionOn",
					{
						objectId,
						functionDeclaration: `function(before) {
							const root = this.getRootNode();
							const active = root.activeElement === this ||
								this.ownerDocument.activeElement === this;
							const value = this.tagName === 'INPUT' ||
								this.tagName === 'TEXTAREA'
								? this.value
								: this.textContent;
							return { active, changed: value !== before };
						}`,
						arguments: [{ value: focusState["before"] }],
						returnByValue: true,
					},
					sessionId,
					signal,
				),
				"typed element response",
			);
			const after = asRecord(
				asRecord(afterResponse["result"], "typed result")["value"],
				"typed state",
			);
			if (after["active"] !== true) {
				throw new Error(
					"Focus changed while typing; input result could not be verified",
				);
			}
			const tag =
				typeof focusState["tag"] === "string" ? focusState["tag"] : "ELEMENT";
			if (after["changed"] !== true) {
				throw new Error(
					`Input.insertText completed but referenced <${tag}> did not change`,
				);
			}
			return `Typed ${text.length} characters into referenced <${tag}>`;
		},
		signal,
	);
}
