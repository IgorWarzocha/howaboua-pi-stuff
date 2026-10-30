import { evaluate } from "./evaluate.js";
import {
	positiveInteger,
	SNAPSHOT_LIMITS,
	type SnapshotOptions,
	type SnapshotResult,
	snapshotResponseLength,
} from "./snapshot-contract.js";
import { renderSnapshotTree } from "./snapshot-tree.js";
import type { CdpConnection, ElementRefs } from "./types.js";
import { asRecord } from "./types.js";

export async function snapshotData(
	cdp: CdpConnection,
	sessionId: string,
	elementRefs: ElementRefs,
	options: SnapshotOptions = {},
): Promise<SnapshotResult> {
	const lineno = positiveInteger(options.lineno ?? 1, "line cursor");
	const responseLength = snapshotResponseLength(options.responseLength);
	const response = asRecord(
		await cdp.send(
			"Accessibility.getFullAXTree",
			{},
			sessionId,
			options.signal,
		),
		"Accessibility response",
	);
	if (!Array.isArray(response["nodes"])) {
		throw new Error("Accessibility response has no nodes");
	}
	const { lines, elements } = renderSnapshotTree(
		response["nodes"],
		elementRefs,
	);

	const metadata = asRecord(
		await evaluate(
			cdp,
			sessionId,
			"({title: document.title, url: location.href})",
			options.signal,
		),
		"page metadata",
	);
	const pattern = options.pattern?.toLowerCase();
	const matching = pattern
		? lines.filter((line) => line.text.toLowerCase().includes(pattern))
		: lines;
	const start = lineno - 1;
	const content = matching
		.slice(start, start + SNAPSHOT_LIMITS[responseLength])
		.map(({ kind: _kind, ...line }) => line);
	const visibleIds = new Set(
		content.flatMap((line) =>
			line.element_id === undefined ? [] : [line.element_id],
		),
	);
	const hasMore = start + content.length < matching.length;
	return {
		...(options.refId ? { ref_id: options.refId } : {}),
		title: typeof metadata["title"] === "string" ? metadata["title"] : "",
		url: typeof metadata["url"] === "string" ? metadata["url"] : "",
		lineno: start + 1,
		content,
		elements: elements.filter((element) => visibleIds.has(element.id)),
		...(options.pattern ? { pattern: options.pattern } : {}),
		...(hasMore ? { next_lineno: start + content.length + 1 } : {}),
	};
}
