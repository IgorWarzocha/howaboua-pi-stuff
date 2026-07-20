import type { ChangedFileFact, HardeningContext } from "./types.js";

export function formatCandidate(candidate: ChangedFileFact): string {
	const change = candidate.deleted
		? "deleted"
		: candidate.untracked
			? "untracked"
			: `+${candidate.additions}/-${candidate.deletions}`;
	return `- ${candidate.path}: ${candidate.lines} lines, ${change}, ${candidate.hunks} changed hunks, ${candidate.moduleStatements} module statements`;
}

export function buildHardeningTask(context: HardeningContext): string {
	return [
		"Run an autonomous agent-native hardening pass over the current branch layer.",
		"",
		`Repository root: ${context.repoRoot}`,
		`Current branch: ${context.currentBranch}`,
		`Chosen base: ${context.base.label}`,
		`Merge base: ${context.base.mergeBase}`,
		`Changed source files: ${context.candidates.length} ranked candidates from ${context.changedFiles.length} changed files`,
		"",
		"Programmatic candidate facts (signals only, not architectural findings):",
		...context.candidates.map(formatCandidate),
		"",
		"Inspect the complete diff and enough surrounding code to make semantic judgments. Refactor every material ownership, boundary, contract, state, duplication, or traversability issue that is justified by repository evidence; multiple coherent extractions are expected when warranted. Preserve behavior, honor repo instructions, and run the relevant checks.",
		"Do not treat size, churn, imports, or this ranking as proof of a defect. You own the architectural diagnosis.",
		"End your final response with exactly [complete] when no material hardening work remains, or [blocker] followed by the concrete blocker. The extension runs existing checks and requests another inspection before handoff when needed.",
	].join("\n");
}
