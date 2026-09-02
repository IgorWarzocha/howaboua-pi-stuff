export type SnapshotResponseLength = "short" | "medium" | "long";

export const SNAPSHOT_LIMITS: Record<SnapshotResponseLength, number> = {
	short: 60,
	medium: 140,
	long: 300,
};

export interface SnapshotLine {
	line: number;
	text: string;
	element_id?: number | undefined;
}

export interface SnapshotElement {
	id: number;
	role: string;
	name?: string | undefined;
	value?: unknown;
}

export interface SnapshotResult {
	ref_id?: string | undefined;
	title: string;
	url: string;
	lineno: number;
	content: SnapshotLine[];
	elements: SnapshotElement[];
	pattern?: string | undefined;
	next_lineno?: number | undefined;
}

export interface SnapshotOptions {
	refId?: string | undefined;
	pattern?: string | undefined;
	lineno?: number | string | undefined;
	responseLength?: SnapshotResponseLength | string | undefined;
	signal?: AbortSignal | undefined;
}

export function positiveInteger(value: number | string, label: string): number {
	const source = String(value);
	if (!/^[1-9]\d*$/.test(source)) {
		throw new Error(`${label} must be a positive integer`);
	}
	const parsed = Number(source);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error(`${label} must be a safe positive integer`);
	}
	return parsed;
}

export function snapshotResponseLength(
	value: string | undefined,
): SnapshotResponseLength {
	const resolved = value ?? "medium";
	if (resolved !== "short" && resolved !== "medium" && resolved !== "long") {
		throw new Error(
			`response length must be one of: ${Object.keys(SNAPSHOT_LIMITS).join(", ")}`,
		);
	}
	return resolved;
}
