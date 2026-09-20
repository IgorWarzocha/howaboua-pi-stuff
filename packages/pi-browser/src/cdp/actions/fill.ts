import type { CdpConnection, ElementRefs } from "../types.js";
import { asRecord } from "../types.js";
import { clickBackendNode } from "./click.js";
import {
	backendCenter,
	requireElementRef,
	withBackendObject,
} from "./element.js";
import { pressKey } from "./key.js";
import { selectorBackendNode } from "./selector.js";

// Runs in the element's realm. Native setters bypass framework value trackers;
// input/change events notify controlled form components of the replacement.
function prepareFill(this: HTMLElement, value: string | boolean) {
	if (!this.isConnected) throw new Error("Element detached; run open again");
	if (
		this.matches(":disabled") ||
		this.getAttribute("aria-disabled") === "true" ||
		this.closest("[inert]")
	) {
		throw new Error("Element is disabled or inert");
	}
	const input = this instanceof HTMLInputElement;
	const textarea = this instanceof HTMLTextAreaElement;
	const select = this instanceof HTMLSelectElement;
	if ((input || textarea) && this.readOnly)
		throw new Error("Element is read-only");
	const toggle = input && (this.type === "checkbox" || this.type === "radio");
	if (toggle) {
		if (typeof value !== "boolean")
			throw new Error("Checkbox/radio requires a boolean value");
		if (this.type === "radio" && !value && this.checked) {
			throw new Error(
				"Select another radio option with value true instead of unchecking this one",
			);
		}
		const indeterminate = this.type === "checkbox" && this.indeterminate;
		if (indeterminate && this.checked === value) {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"checked",
			)?.set;
			if (!setter) throw new Error("Checkbox has no native checked setter");
			// A click clears indeterminate and toggles checked. Start from the
			// opposite state so that single click lands on the requested value.
			setter.call(this, !value);
		}
		return {
			kind: "checked",
			expected: value,
			needsClick: this.checked !== value || indeterminate,
		};
	}
	if (typeof value !== "string")
		throw new Error("Text fields and selects require a string value");
	if (
		input &&
		![
			"text",
			"search",
			"email",
			"url",
			"tel",
			"password",
			"number",
			"date",
			"time",
			"datetime-local",
			"month",
			"week",
		].includes(this.type)
	) {
		throw new Error(`Input type ${this.type} does not support fill`);
	}
	if (!input && !textarea && !select && !this.isContentEditable) {
		throw new Error("Element is not an editable form control");
	}
	let replacement = value;
	if (select) {
		if (this.multiple) throw new Error("fill requires a single-select control");
		const options = Array.from(this.options);
		const byValue = options.filter((option) => option.value === value);
		const matches = byValue.length
			? byValue
			: options.filter((option) => option.label.trim() === value);
		const option = matches[0];
		if (matches.length !== 1 || !option)
			throw new Error("Option value/label must match exactly one option");
		if (option.matches(":disabled")) throw new Error("Option is disabled");
		replacement = option.value;
	}
	this.focus({ preventScroll: true });
	const root = this.getRootNode() as Document | ShadowRoot;
	if (!this.isConnected || root.activeElement !== this) {
		throw new Error("Could not focus element; fill was not sent");
	}
	if (!input && !textarea && !select) {
		const selection = this.ownerDocument.getSelection();
		if (!selection) throw new Error("Could not select editable text");
		const range = this.ownerDocument.createRange();
		range.selectNodeContents(this);
		selection.removeAllRanges();
		selection.addRange(range);
		return { kind: "contenteditable", expected: value };
	}
	const prototype = input
		? HTMLInputElement.prototype
		: textarea
			? HTMLTextAreaElement.prototype
			: HTMLSelectElement.prototype;
	const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
	if (!setter) throw new Error("Form control has no native value setter");
	if (input || textarea) {
		const probe = this.cloneNode(false) as
			| HTMLInputElement
			| HTMLTextAreaElement;
		setter.call(probe, replacement);
		if (probe.value !== replacement)
			throw new Error(
				"Value is not accepted by this control; fill was not sent",
			);
	}
	setter.call(this, replacement);
	this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
	this.dispatchEvent(new Event("change", { bubbles: true }));
	return { kind: "value", expected: replacement };
}

async function callElement(
	cdp: CdpConnection,
	sessionId: string,
	objectId: string,
	declaration: string,
	value: unknown,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const response = asRecord(
		await cdp.send(
			"Runtime.callFunctionOn",
			{
				objectId,
				functionDeclaration: declaration,
				arguments: [{ value }],
				returnByValue: true,
			},
			sessionId,
			signal,
		),
	);
	if (response["exceptionDetails"]) {
		const details = asRecord(response["exceptionDetails"]);
		const exception = details["exception"]
			? asRecord(details["exception"])
			: {};
		throw new Error(
			typeof exception["description"] === "string"
				? exception["description"]
				: "Fill failed; run open to inspect the control before retrying",
		);
	}
	return asRecord(asRecord(response["result"])["value"], "fill result");
}

export async function fillElement(
	cdp: CdpConnection,
	sessionId: string,
	elementRefs: ElementRefs,
	target: { id: number; selector?: never } | { selector: string; id?: never },
	value: string | boolean,
	signal?: AbortSignal,
): Promise<string> {
	const backendNodeId =
		target.id !== undefined
			? requireElementRef(elementRefs, target.id).backendNodeId
			: await selectorBackendNode(cdp, sessionId, target.selector, signal);
	await backendCenter(cdp, sessionId, backendNodeId, true, signal);
	return withBackendObject(
		cdp,
		sessionId,
		backendNodeId,
		async (objectId) => {
			const prepared = await callElement(
				cdp,
				sessionId,
				objectId,
				prepareFill.toString(),
				value,
				signal,
			);
			if (prepared["kind"] === "checked" && prepared["needsClick"] === true) {
				await clickBackendNode(cdp, sessionId, backendNodeId, signal);
			} else if (prepared["kind"] === "contenteditable") {
				const focused = await callElement(
					cdp,
					sessionId,
					objectId,
					`function() {
					const selection = this.ownerDocument.getSelection();
					return { ok: this.isConnected && this.getRootNode().activeElement === this &&
						selection && this.contains(selection.anchorNode) && this.contains(selection.focusNode) };
				}`,
					null,
					signal,
				);
				if (focused["ok"] !== true)
					throw new Error("Focus or selection changed; fill was not sent");
				if (value === "") await pressKey(cdp, sessionId, "Backspace", signal);
				else
					await cdp.send(
						"Input.insertText",
						{ text: value },
						sessionId,
						signal,
					);
			}
			const verified = await callElement(
				cdp,
				sessionId,
				objectId,
				`function(expected) {
			if (!this.isConnected) return { ok: false };
			const toggle = this instanceof HTMLInputElement && (this.type === 'checkbox' || this.type === 'radio');
			// Editable DOM has no value property. Native editing introduces NBSPs
			// and block/BR nodes, so compare equivalent rendered text, not markup.
			if (this.isContentEditable) {
				const normalize = text => text.replace(/\\s+/g, ' ').trim();
				return { ok: normalize(this.innerText) === normalize(expected) };
			}
			const actual = toggle ? this.checked : this.value;
			return { ok: actual === expected && (!toggle || !this.indeterminate) };
		}`,
				prepared["expected"],
				signal,
			);
			if (verified["ok"] !== true) {
				throw new Error(
					"Fill did not retain the requested value; run open to inspect the control before retrying",
				);
			}
			return target.id === undefined
				? "Filled selected element"
				: `Filled element ${target.id}`;
		},
		signal,
	);
}
