import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { MAX_BTW_SESSIONS, NUMBERED_SESSION_PATTERN } from "./constants.js";
import type { BtwMessageDetails } from "./messages.js";
import { doneTurns } from "./output.js";
import { BtwChild } from "./rpc-child.js";
import type { BtwSession, BtwState, BtwTurn } from "./types.js";

export function createInitialState(): BtwState {
	return { sessions: [], activeIndex: 0, folded: false, ctx: undefined };
}

export function listSessions(state: BtwState) {
	return state.sessions.filter((session): session is BtwSession => !!session);
}

export function activeSession(state: BtwState) {
	return state.sessions[state.activeIndex];
}

export function sessionStatus(session: BtwSession) {
	if (session.running || session.turns.some((turn) => turn.status === "queued"))
		return "running";
	if (session.unread) return "unread";
	if (session.turns.some((turn) => turn.error)) return "failed";
	if (doneTurns(session.turns).length > 0) return "answered";
	return "ready";
}

function makeSession(index: number): BtwSession {
	return {
		index,
		generationId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
		nextTurnIndex: 1,

		turns: [],
		running: false,
		unread: false,
		generation: 0,
		queue: Promise.resolve(),
	};
}

function lowestFreeIndex(state: BtwState) {
	const index = state.sessions.findIndex((session) => !session);
	return index === -1 ? state.sessions.length : index;
}

export function switchToSession(state: BtwState, index: number) {
	const session = state.sessions[index];
	if (!session) return false;
	state.activeIndex = index;
	state.folded = false;
	session.unread = false;
	return true;
}

export function switchRelativeSession(state: BtwState, direction: number) {
	const sessions = listSessions(state);
	if (sessions.length === 0) return false;
	const currentPosition = Math.max(
		0,
		sessions.findIndex((session) => session.index === state.activeIndex),
	);
	const next =
		sessions[(currentPosition + direction + sessions.length) % sessions.length];
	return next ? switchToSession(state, next.index) : false;
}

export function createSession(state: BtwState, index = lowestFreeIndex(state)) {
	if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_BTW_SESSIONS) {
		throw new Error(
			`BTW session index must be between 0 and ${MAX_BTW_SESSIONS - 1}.`,
		);
	}
	while (state.sessions.length <= index) state.sessions.push(undefined);
	const session = makeSession(index);
	state.sessions[index] = session;
	state.activeIndex = index;
	state.folded = false;
	return session;
}

export function restoreSession(
	state: BtwState,
	args: { generationId: string; index: number; turns: BtwTurn[] },
) {
	if (
		!Number.isSafeInteger(args.index) ||
		args.index < 0 ||
		args.index >= MAX_BTW_SESSIONS
	)
		return undefined;
	while (state.sessions.length <= args.index) state.sessions.push(undefined);
	const session = makeSession(args.index);
	session.generationId = args.generationId;
	session.turns = args.turns;
	session.restored = true;
	session.nextTurnIndex =
		Math.max(0, ...args.turns.map((turn) => turn.turnIndex ?? 0)) + 1;
	state.sessions[args.index] = session;
	if (!state.sessions[state.activeIndex]) state.activeIndex = args.index;
	return session;
}

export function ensureSession(state: BtwState, index: number) {
	if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_BTW_SESSIONS) {
		throw new Error(
			`BTW session number must be between 1 and ${MAX_BTW_SESSIONS}.`,
		);
	}
	const session = state.sessions[index] ?? createSession(state, index);
	switchToSession(state, index);
	return session;
}

function selectNearestSession(state: BtwState, clearedIndex: number) {
	const sessions = listSessions(state);
	if (sessions.length === 0) {
		state.activeIndex = 0;
		return;
	}
	const next =
		sessions.find((session) => session.index > clearedIndex) ??
		sessions.findLast((session) => session.index < clearedIndex) ??
		sessions[0];
	state.activeIndex = next!.index;
}

export async function clearSession(state: BtwState, session: BtwSession) {
	session.generation++;
	session.turns = [];
	session.running = false;
	session.unread = false;
	session.queue = Promise.resolve();
	state.sessions[session.index] = undefined;
	selectNearestSession(state, session.index);
	const child = session.child;
	delete session.child;
	await child?.stop();
}

export function parseBtwArgs(args: string) {
	const trimmed = args.trim();
	if (!trimmed) return { sessionNumber: undefined, question: "" };
	const match = trimmed.match(NUMBERED_SESSION_PATTERN);
	if (!match) return { sessionNumber: undefined, question: trimmed };
	return {
		sessionNumber: Number(match[1]),
		question: match[2]?.trim() ?? "",
	};
}

function getBtwDetails(message: {
	customType?: string;
	details?: unknown;
}): BtwMessageDetails | undefined {
	const customType = String(message.customType ?? "");
	if (
		customType !== "BTW SESSION" &&
		customType !== "smart-btw-result" &&
		!customType.startsWith("BTW SESSION ")
	)
		return undefined;
	const details = message.details;
	if (typeof details !== "object" || details === null) return undefined;
	const record = details as BtwMessageDetails;
	if (typeof record.generation !== "string") return undefined;
	if (!Number.isInteger(record.slot) || record.slot < 1) return undefined;
	return record;
}

function legacyTurnFromMessage(message: {
	content?: unknown;
	details?: unknown;
}): BtwTurn | undefined {
	const details = message.details;
	if (typeof details !== "object" || details === null) return undefined;
	const record = details as {
		question?: string;
		answer?: string;
		error?: string;
		startedAt?: number;
		finishedAt?: number;
	};
	if (!record.question && !record.answer && !record.error) return undefined;
	return {
		question: String(record.question ?? ""),
		answer: typeof record.answer === "string" ? record.answer : undefined,
		error: typeof record.error === "string" ? record.error : undefined,
		startedAt:
			typeof record.startedAt === "number" ? record.startedAt : Date.now(),
		finishedAt:
			typeof record.finishedAt === "number" ? record.finishedAt : undefined,
		status: record.error ? "failed" : "answered",
	} as BtwTurn;
}

type GenerationRecord = {
	cleared: boolean;
	generationId: string;
	slot: number;
	turns: BtwTurn[];
};

function getGenerationRecord(
	generations: Map<string, GenerationRecord>,
	details: BtwMessageDetails,
) {
	const key = `${details.slot}:${details.generation}`;
	const record = generations.get(key) ?? {
		cleared: false,
		generationId: details.generation,
		slot: details.slot,
		turns: [],
	};
	generations.set(key, record);
	return record;
}

function restoredTurnFromDetails(
	details: BtwMessageDetails,
	fallbackTurnIndex: number,
): BtwTurn {
	return {
		question: String(details.question ?? ""),
		answer: typeof details.answer === "string" ? details.answer : undefined,
		error: typeof details.error === "string" ? details.error : undefined,
		startedAt:
			typeof details.startedAt === "number" ? details.startedAt : Date.now(),
		finishedAt:
			typeof details.finishedAt === "number" ? details.finishedAt : undefined,
		status: details.error ? "failed" : "answered",
		turnIndex: Number.isInteger(details.turn)
			? details.turn
			: fallbackTurnIndex,
	} as BtwTurn;
}

function collectBtwGenerations(
	messages: {
		customType?: string;
		details?: unknown;
		content?: unknown;
	}[],
) {
	const generations = new Map<string, GenerationRecord>();
	const legacyTurns: BtwTurn[] = [];
	for (const message of messages) {
		const details = getBtwDetails(message);
		if (details) {
			const record = getGenerationRecord(generations, details);
			if (details.kind === "cleared") record.cleared = true;
			if (details.kind === "result")
				record.turns.push(
					restoredTurnFromDetails(details, record.turns.length + 1),
				);
			continue;
		}
		const legacy = legacyTurnFromMessage(message);
		if (legacy) legacyTurns.push(legacy);
	}
	if (legacyTurns.length > 0) {
		const existingLegacy = generations.get("1:legacy");
		generations.set("1:legacy", {
			cleared: existingLegacy?.cleared ?? false,
			generationId: "legacy",
			slot: 1,
			turns: legacyTurns.map((turn, index) => ({
				...turn,
				turnIndex: index + 1,
			})),
		});
	}
	return generations;
}

function latestOpenGenerationsBySlot(
	generations: Map<string, GenerationRecord>,
) {
	const latestBySlot = new Map<number, GenerationRecord>();
	for (const record of generations.values()) {
		if (record.cleared || record.turns.length === 0) continue;
		latestBySlot.set(record.slot, record);
	}
	return latestBySlot;
}

export function restoreStateFromMessages(
	state: BtwState,
	messages: {
		customType?: string;
		details?: unknown;
		content?: unknown;
	}[],
) {
	const latestBySlot = latestOpenGenerationsBySlot(
		collectBtwGenerations(messages),
	);
	for (const session of listSessions(state)) {
		const latest = latestBySlot.get(session.index + 1);
		if (latest?.generationId === session.generationId) continue;
		const hasPendingWork =
			session.running ||
			session.turns.some(
				(turn) => turn.status === "queued" || turn.status === "running",
			);
		if (hasPendingWork) continue;
		state.sessions[session.index] = undefined;
		void session.child?.stop();
	}
	for (const record of latestBySlot.values()) {
		const existing = state.sessions[record.slot - 1];
		if (existing?.generationId === record.generationId) continue;
		record.turns.sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0));
		restoreSession(state, {
			generationId: record.generationId,
			index: record.slot - 1,
			turns: record.turns,
		});
	}
	if (!state.sessions[state.activeIndex])
		state.activeIndex = listSessions(state)[0]?.index ?? 0;
}

function isCurrentGeneration(session: BtwSession, generation: number) {
	return session.generation === generation;
}

function formatRestoredFollowUpPrompt(
	session: BtwSession,
	currentTurn: BtwTurn,
	question: string,
	nextTurnIndex: number,
) {
	const restoredTurns = doneTurns(
		session.turns.filter((turn) => turn !== currentTurn),
	);
	if (!(session.restored && restoredTurns.length > 0 && !session.child))
		return undefined;
	return [
		"This is a restored Q&A session. Continue from these prior turns...",
		"",
		...restoredTurns.flatMap((turn, index) => [
			`Q${index + 1}: ${turn.question}`,
			`A${index + 1}: ${turn.answer || turn.error || "(no answer)"}`,
			"",
		]),
		"Gather context required to answer this follow-up question and naturally resume the Q&A",
		"",
		`Q${nextTurnIndex}: ${question}`,
	].join("\n");
}

function finishTurn(args: {
	ctx: ExtensionContext;
	pi: ExtensionAPI;
	state: BtwState;
	session: BtwSession;
	turn: BtwTurn;
	generation: number;
	sendResultMessage: (
		pi: ExtensionAPI,
		session: BtwSession,
		turn: BtwTurn,
	) => void;
	render: (ctx: ExtensionContext, state: BtwState) => void;
}) {
	const {
		ctx,
		pi,
		state,
		session,
		turn,
		generation,
		sendResultMessage,
		render,
	} = args;
	if (!isCurrentGeneration(session, generation)) return;
	turn.finishedAt = Date.now();
	session.running = false;
	if (turn.answer || turn.error) {
		turn.status = turn.error ? "failed" : "answered";
		session.unread = !(state.activeIndex === session.index && !state.folded);
		sendResultMessage(pi, session, turn);
	}
	render(ctx, state);
}

export async function runBtwTurn(args: {
	ctx: ExtensionContext;
	pi: ExtensionAPI;
	question: string;
	state: BtwState;
	session: BtwSession;
	turn: BtwTurn;
	generation: number;
	sendResultMessage: (
		pi: ExtensionAPI,
		session: BtwSession,
		turn: BtwTurn,
	) => void;
	render: (ctx: ExtensionContext, state: BtwState) => void;
}) {
	const {
		ctx,
		pi,
		question,
		state,
		session,
		turn,
		generation,
		sendResultMessage,
		render,
	} = args;
	if (!isCurrentGeneration(session, generation)) return;
	session.running = true;
	turn.status = "running";
	turn.turnIndex ??= session.nextTurnIndex++;
	render(ctx, state);
	try {
		const prompt = formatRestoredFollowUpPrompt(
			session,
			turn,
			question,
			turn.turnIndex,
		);
		if (!session.child) {
			session.child = new BtwChild(ctx.cwd, () => render(ctx, state));
			await session.child.ready();
		}
		if (!isCurrentGeneration(session, generation)) return;
		turn.answer =
			(await session.child.ask(
				question,
				(partial) => {
					turn.partial = partial;
					render(ctx, state);
				},
				prompt,
			)) || "(no answer)";
		session.restored = false;
		delete turn.partial;
	} catch (error) {
		if (!isCurrentGeneration(session, generation)) return;
		turn.error = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`/btw failed: ${turn.error}`, "error");
	} finally {
		finishTurn({
			ctx,
			pi,
			state,
			session,
			turn,
			generation,
			sendResultMessage,
			render,
		});
	}
}
