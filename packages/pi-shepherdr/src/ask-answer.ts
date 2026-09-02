import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgent } from "./herdr.js";
import type { HerdrConnection } from "./herdr-client.js";
import type { AgentMonitor } from "./monitor.js";
import type { PaneInfo, PendingAsk } from "./types.js";

export interface AskAnswer {
	comment?: string;
	other?: string;
	selections?: string[];
}

interface InputStep {
	final?: boolean;
	keys?: string[];
	text?: string;
}

interface AskControls {
	confirm: string;
	down: string;
	next: string;
}

function down(count: number, key: string): string[] {
	return Array.from({ length: Math.max(0, count) }, () => key);
}

function answerPlan(
	prompts: PendingAsk["prompts"],
	answers: AskAnswer[],
	controls: AskControls,
): InputStep[] {
	if (answers.length !== prompts.length) {
		throw new Error(
			`answer requires ${prompts.length} response${prompts.length === 1 ? "" : "s"}, in prompt order`,
		);
	}
	const steps: InputStep[] = [];
	for (const [promptIndex, prompt] of prompts.entries()) {
		const answer = answers[promptIndex]!;
		const labels = answer.selections ?? [];
		const indexes = labels.map((label) => {
			const index = prompt.choices.findIndex(
				(choice) => choice.label === label,
			);
			if (index < 0) {
				throw new Error(
					`unknown choice ${JSON.stringify(label)} for ${JSON.stringify(prompt.title)}`,
				);
			}
			return index;
		});
		if (new Set(indexes).size !== indexes.length) {
			throw new Error(`duplicate choice for ${JSON.stringify(prompt.title)}`);
		}
		if (!prompt.multiple && indexes.length > 1) {
			throw new Error(`${JSON.stringify(prompt.title)} accepts one choice`);
		}
		if (!prompt.multiple && indexes.length > 0 && answer.other !== undefined) {
			throw new Error(
				`${JSON.stringify(prompt.title)} cannot combine a choice with Other/rephrase`,
			);
		}
		indexes.sort((left, right) => left - right);
		let focus = 0;
		for (const index of indexes) {
			steps.push({
				keys: [...down(index - focus, controls.down), controls.confirm],
			});
			focus = index;
		}
		const needsOther =
			answer.other !== undefined ||
			(indexes.length === 0 && answer.comment !== undefined);
		if (needsOther) {
			steps.push({
				keys: [
					...down(prompt.choices.length - focus, controls.down),
					controls.confirm,
				],
			});
			steps.push({
				text: answer.other ?? "",
				keys: [controls.confirm],
			});
			focus = prompt.choices.length;
		}
		if (answer.comment !== undefined) {
			steps.push({
				keys: [
					...down(prompt.choices.length + 1 - focus, controls.down),
					controls.confirm,
				],
			});
			steps.push({ text: answer.comment, keys: [controls.next] });
		} else {
			steps.push({ keys: [controls.next] });
		}
	}
	steps.push({ keys: [controls.confirm], final: true });
	return steps;
}

async function readKeybindings(
	client: HerdrConnection,
): Promise<Record<string, unknown>> {
	if ("keybindings" in client && typeof client.keybindings === "function") {
		const value = await client.keybindings();
		return typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	}
	const directory =
		process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
	try {
		const value = JSON.parse(
			await readFile(join(directory, "keybindings.json"), "utf8"),
		) as unknown;
		return typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function keyFor(
	bindings: Record<string, unknown>,
	action: string,
	fallback: string,
): string {
	const configured = bindings[action];
	if (typeof configured === "string" && configured) return configured;
	if (Array.isArray(configured)) {
		const first = configured.find(
			(key) => typeof key === "string" && key.length > 0,
		);
		if (typeof first === "string") return first;
		if (configured.length === 0) {
			throw new Error(`${action} has no configured keybinding`);
		}
	}
	return fallback;
}

async function screen(
	client: HerdrConnection,
	paneId: string,
): Promise<string> {
	const result = await client.request<unknown>("agent.read", {
		target: paneId,
		source: "visible",
		format: "text",
		lines: 80,
		strip_ansi: true,
	});
	if (
		typeof result !== "object" ||
		result === null ||
		!("read" in result) ||
		typeof result.read !== "object" ||
		result.read === null ||
		!("text" in result.read) ||
		typeof result.read.text !== "string"
	) {
		throw new Error("Herdr agent.read returned no text");
	}
	return result.read.text;
}

function askFrame(value: string): string {
	const lines = value.split("\n");
	const review = lines.map((line) => line.includes("Review")).lastIndexOf(true);
	return (review >= 0 ? lines.slice(review) : lines.slice(-30)).join("\n");
}

function inspectAskScreen(
	value: string,
	ask: PendingAsk,
): { currentPrompt?: string; recognized: boolean; selected?: string } {
	const frame = askFrame(value);
	const selected = frame.match(/^>\s+(.*?)\s*$/m)?.[1];
	const review =
		/^\s*Review\s*$/m.test(frame) && frame.includes("enter submit");
	const currentPrompt = review
		? "Review"
		: ask.prompts.find((prompt) =>
				frame.split("\n").some((line) => line.trim() === prompt.title),
			)?.title;
	return {
		recognized:
			Boolean(currentPrompt) ||
			(frame.includes("Other/rephrase") &&
				frame.includes("Comment (optional)")),
		...(currentPrompt ? { currentPrompt } : {}),
		...(selected ? { selected } : {}),
	};
}

async function sendInput(
	client: HerdrConnection,
	panel: PaneInfo,
	step: InputStep,
	signal: AbortSignal,
): Promise<void> {
	signal.throwIfAborted();
	if (step.text !== undefined) {
		await requireSameAgent(client, panel);
		await client.request("pane.send_input", {
			pane_id: panel.pane_id,
			text: step.text,
		});
	}
	if (step.keys) {
		await requireSameAgent(client, panel);
		await client.request("agent.send_keys", {
			target: panel.pane_id,
			keys: step.keys,
		});
	}
}

async function requireSameAgent(
	client: HerdrConnection,
	panel: PaneInfo,
): Promise<void> {
	const current = await getAgent(client, panel.pane_id);
	if (current.terminal_id !== panel.terminal_id) {
		throw new Error(`${panel.pane_id} no longer hosts the targeted Pi agent`);
	}
}

export async function prepareAskAnswer(
	client: HerdrConnection,
	monitor: AgentMonitor,
	panel: PaneInfo,
	answers: AskAnswer[],
	signal: AbortSignal,
): Promise<{ ask: PendingAsk; submit(): Promise<void> }> {
	if (panel.agent_status !== "blocked") {
		throw new Error(
			`${panel.pane_id} is ${panel.agent_status}, not blocked on ask`,
		);
	}
	const view = await monitor.view(panel);
	if (!view.ask) {
		throw new Error(
			`${panel.pane_id} has no pending pi-ask call on its active branch`,
		);
	}
	const ask = view.ask;
	const initial = inspectAskScreen(await screen(client, panel.pane_id), ask);
	const first = ask.prompts[0];
	const expectedSelection = first?.choices[0]?.label ?? "Other/rephrase";
	if (
		!initial.recognized ||
		initial.currentPrompt !== first?.title ||
		initial.selected !== expectedSelection
	) {
		throw new Error(
			"ask UI is not at the first prompt's default selection; refusing to send guessed keys",
		);
	}
	const bindings = await readKeybindings(client);
	const plan = answerPlan(ask.prompts, answers, {
		down: keyFor(bindings, "tui.select.down", "down"),
		confirm: keyFor(bindings, "tui.select.confirm", "enter"),
		next: keyFor(bindings, "tui.input.tab", "tab"),
	});
	const final = plan.pop();
	if (!final?.final) throw new Error("ask answer plan has no final submission");
	for (const step of plan) {
		await sendInput(client, panel, step, signal);
		await new Promise((resolve) => setTimeout(resolve, 35));
		const current = await getAgent(client, panel.pane_id);
		if (
			current.terminal_id !== panel.terminal_id ||
			current.agent_status !== "blocked"
		) {
			throw new Error("ask closed before all requested answers were entered");
		}
		if (
			!inspectAskScreen(await screen(client, panel.pane_id), ask).recognized
		) {
			throw new Error(
				"ask UI became unrecognized; stopped without retrying input",
			);
		}
	}
	return {
		ask,
		submit: () => sendInput(client, panel, final, signal),
	};
}
