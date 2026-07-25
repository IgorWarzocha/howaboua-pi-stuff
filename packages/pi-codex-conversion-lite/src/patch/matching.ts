export type LinesMatchQuality = {
	fuzz: number;
	worstLineFuzz: number;
};

export function lineMatchFuzz(left: string, right: string): number | undefined {
	if (left === right) return 0;
	if (left.trimEnd() === right.trimEnd()) return 1;
	if (left.trim() === right.trim()) return 100;
	return undefined;
}

export function linesMatch(left: string, right: string): boolean {
	return left === right || left.trimEnd() === right.trimEnd();
}

export function linesEqualFuzz({ left, right }: { left: string[]; right: string[] }): LinesMatchQuality | undefined {
	if (left.length !== right.length) return undefined;

	let fuzz = 0;
	let worstLineFuzz = 0;
	for (let index = 0; index < left.length; index++) {
		const lineFuzz = lineMatchFuzz(left[index]!, right[index]!);
		if (lineFuzz === undefined) return undefined;
		fuzz += lineFuzz;
		worstLineFuzz = Math.max(worstLineFuzz, lineFuzz);
	}

	return { fuzz, worstLineFuzz };
}
