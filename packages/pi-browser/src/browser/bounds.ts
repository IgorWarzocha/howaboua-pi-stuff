import { getDisplayPrefixLength } from "../cdp/discovery.js";
import type {
	SnapshotElement,
	SnapshotResult,
} from "../cdp/snapshot-contract.js";
import type { PageInfo } from "../cdp/types.js";

const OUTPUT_BUDGET_BYTES = 38_000;

function byteLength(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value));
}

export function boundTabs(
	pages: PageInfo[],
	query: string | undefined,
	offset: number,
): Record<string, unknown> {
	const prefixLength = getDisplayPrefixLength(
		pages.map((page) => page.targetId),
	);
	let filtered = pages;
	if (query) {
		const normalized = query.toLowerCase();
		filtered = pages.filter((page) =>
			`${page.title}\n${page.url}`.toLowerCase().includes(normalized),
		);
	}
	if (offset > filtered.length) {
		throw new Error(`offset ${offset} exceeds tab count ${filtered.length}`);
	}
	const tabs: Array<{
		ref_id: string;
		title: string;
		url: string;
	}> = [];
	for (const page of filtered.slice(offset)) {
		const compact = {
			ref_id: page.targetId.slice(0, prefixLength),
			title: page.title.slice(0, 500),
			url: page.url.slice(0, 8_000),
		};
		if (byteLength({ tabs: [...tabs, compact] }) > OUTPUT_BUDGET_BYTES) {
			break;
		}
		tabs.push(compact);
	}
	const remaining = filtered.length - offset - tabs.length;
	return {
		offset,
		tabs,
		...(remaining > 0
			? {
					truncated: true,
					omitted_tabs: remaining,
					next_offset: offset + tabs.length,
				}
			: {}),
	};
}

export function boundSnapshot(page: SnapshotResult): Record<string, unknown> {
	const base = {
		ref_id: page.ref_id,
		title: page.title,
		url: page.url,
		lineno: page.lineno,
		...(page.pattern ? { pattern: page.pattern } : {}),
	};
	const elements = new Map<number, SnapshotElement>(
		page.elements.map((element) => [element.id, element]),
	);
	const content: SnapshotResult["content"] = [];
	const includedElements: SnapshotElement[] = [];
	const includedIds = new Set<number>();
	for (const line of page.content) {
		const nextContent = [...content, line];
		const nextElements = [...includedElements];
		if (
			line.element_id !== undefined &&
			!includedIds.has(line.element_id) &&
			elements.has(line.element_id)
		) {
			const element = elements.get(line.element_id);
			if (element) nextElements.push(element);
		}
		if (
			byteLength({
				...base,
				content: nextContent,
				elements: nextElements,
			}) > OUTPUT_BUDGET_BYTES
		) {
			break;
		}
		content.push(line);
		if (
			line.element_id !== undefined &&
			!includedIds.has(line.element_id) &&
			elements.has(line.element_id)
		) {
			includedIds.add(line.element_id);
			const element = elements.get(line.element_id);
			if (element) includedElements.push(element);
		}
	}
	const omitted = content.length < page.content.length;
	return {
		...base,
		content,
		elements: includedElements,
		...(omitted || page.next_lineno
			? {
					truncated: true,
					next_lineno: omitted
						? page.lineno + content.length
						: page.next_lineno,
				}
			: {}),
	};
}
