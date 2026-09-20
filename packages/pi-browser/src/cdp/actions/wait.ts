import { sleep } from "../discovery.js";
import { evaluate } from "../evaluate.js";
import type { CdpConnection } from "../types.js";
import { errorMessage } from "../types.js";

export type WaitCondition =
	| { selector: string }
	| { text: string }
	| { url_includes: string };

const POLL_INTERVAL_MS = 100;
const SUMMARY_LENGTH = 120;
const NAVIGATION_CONTEXT_ERRORS = [
	/(?:^|: )Execution context was destroyed\b/i,
	/(?:^|: )Cannot find context with specified id\b/i,
	/(?:^|: )Cannot find (?:default )?execution context\b/i,
	/(?:^|: )No execution context with given id\b/i,
];

function conditionDetails(condition: WaitCondition): {
	expression: string;
	label: string;
	matched: string;
} {
	if ("selector" in condition) {
		return {
			expression: `document.querySelector(${JSON.stringify(condition.selector)}) !== null`,
			label: `selector ${summary(condition.selector)}`,
			matched: `Matched selector ${summary(condition.selector)}`,
		};
	}
	if ("text" in condition) {
		return {
			expression: `document.body?.innerText.includes(${JSON.stringify(condition.text)}) ?? false`,
			label: `text ${summary(condition.text)}`,
			matched: `Matched text ${summary(condition.text)}`,
		};
	}
	return {
		expression: `location.href.includes(${JSON.stringify(condition.url_includes)})`,
		label: `URL containing ${summary(condition.url_includes)}`,
		matched: `Matched URL containing ${summary(condition.url_includes)}`,
	};
}

function summary(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	const bounded =
		normalized.length > SUMMARY_LENGTH
			? `${normalized.slice(0, SUMMARY_LENGTH - 3)}...`
			: normalized;
	return JSON.stringify(bounded);
}

function isNavigationContextError(error: unknown): boolean {
	const message = errorMessage(error);
	return NAVIGATION_CONTEXT_ERRORS.some((pattern) => pattern.test(message));
}

export async function waitForCondition(
	cdp: CdpConnection,
	sessionId: string,
	condition: WaitCondition,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<string> {
	const details = conditionDetails(condition);
	const timeoutError = new Error(
		`Timed out after ${timeoutMs}ms waiting for ${details.label}`,
	);
	const deadline = Date.now() + timeoutMs;
	const controller = new AbortController();
	let timedOut = false;
	const abort = () => {
		controller.abort(signal?.reason ?? new Error("Wait aborted"));
	};
	if (signal?.aborted) {
		abort();
	} else {
		signal?.addEventListener("abort", abort, { once: true });
	}
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(timeoutError);
	}, timeoutMs);

	try {
		while (Date.now() < deadline) {
			try {
				const matched = await evaluate(
					cdp,
					sessionId,
					details.expression,
					controller.signal,
				);
				if (matched === true) return details.matched;
				if (matched !== false) {
					throw new Error("Wait condition returned a non-boolean result");
				}
			} catch (error) {
				if (controller.signal.aborted) throw controller.signal.reason;
				if (!isNavigationContextError(error)) throw error;
			}

			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			await sleep(Math.min(POLL_INTERVAL_MS, remaining), controller.signal);
		}
		throw timeoutError;
	} catch (error) {
		if (timedOut) throw timeoutError;
		throw error;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", abort);
	}
}
