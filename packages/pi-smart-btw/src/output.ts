import type { BtwTurn } from "./types.js";

export function doneTurns(turns: BtwTurn[]) {
	return turns.filter((turn) => turn.answer || turn.error);
}

export function injectionText(turns: BtwTurn[]) {
	const completed = doneTurns(turns);
	if (completed.length === 1) {
		const turn = completed[0]!;
		return [
			"The user asked the following question in a separate session:",
			turn.question,
			"The answer was:",
			turn.answer || turn.error || "(no answer)",
			"Take it into account while executing the current task.",
		].join("\n");
	}

	return [
		"The user asked the following questions in a separate session:",
		...completed.flatMap((turn, index) => [
			"",
			`Question ${index + 1}:`,
			turn.question,
			"Answer:",
			turn.answer || turn.error || "(no answer)",
		]),
		"",
		"Take them into account while executing the current task.",
	].join("\n");
}
