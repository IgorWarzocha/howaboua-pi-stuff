import { evaluate } from "./evaluate.js";
import {
	positiveInteger,
	SNAPSHOT_LIMITS,
	type SnapshotElement,
	type SnapshotLine,
	type SnapshotOptions,
	type SnapshotResult,
	snapshotResponseLength,
} from "./snapshot-contract.js";
import type { CdpConnection, ElementRefs } from "./types.js";
import { asRecord } from "./types.js";

interface AxValue {
	value?: unknown;
}

interface AxNode {
	nodeId: string;
	parentId?: string | undefined;
	childIds?: string[] | undefined;
	backendDOMNodeId?: number | undefined;
	ignored?: boolean | undefined;
	role?: AxValue | undefined;
	name?: AxValue | undefined;
	value?: AxValue | undefined;
}

const INTERACTIVE_ROLES = new Set([
	"button",
	"checkbox",
	"combobox",
	"link",
	"listbox",
	"menuitem",
	"option",
	"menuitemcheckbox",
	"menuitemradio",
	"radio",
	"searchbox",
	"slider",
	"spinbutton",
	"switch",
	"tab",
	"textbox",
	"treeitem",
]);
const NEXT_ELEMENT_IDS = new WeakMap<ElementRefs, number>();

function axNode(value: unknown): AxNode {
	const record = asRecord(value, "accessibility node");
	if (typeof record["nodeId"] !== "string") {
		throw new Error("Accessibility node has no nodeId");
	}
	return {
		nodeId: record["nodeId"],
		...(typeof record["parentId"] === "string"
			? { parentId: record["parentId"] }
			: {}),
		...(Array.isArray(record["childIds"])
			? {
					childIds: record["childIds"].filter(
						(id): id is string => typeof id === "string",
					),
				}
			: {}),
		...(typeof record["backendDOMNodeId"] === "number"
			? { backendDOMNodeId: record["backendDOMNodeId"] }
			: {}),
		...(typeof record["ignored"] === "boolean"
			? { ignored: record["ignored"] }
			: {}),
		...(record["role"] ? { role: asRecord(record["role"]) } : {}),
		...(record["name"] ? { name: asRecord(record["name"]) } : {}),
		...(record["value"] ? { value: asRecord(record["value"]) } : {}),
	};
}

function shouldShow(node: AxNode): boolean {
	const role = String(node.role?.value ?? "");
	const name = node.name?.value ?? "";
	const value = node.value?.value;
	if (role === "InlineTextBox") return false;
	return (
		role !== "none" &&
		role !== "generic" &&
		!(name === "" && (value === "" || value == null))
	);
}

function orderedChildren(
	node: AxNode,
	nodesById: Map<string, AxNode>,
	childrenByParent: Map<string, AxNode[]>,
): AxNode[] {
	const children: AxNode[] = [];
	const seen = new Set<string>();
	for (const childId of node.childIds ?? []) {
		const child = nodesById.get(childId);
		if (child && !seen.has(child.nodeId)) {
			seen.add(child.nodeId);
			children.push(child);
		}
	}
	for (const child of childrenByParent.get(node.nodeId) ?? []) {
		if (!seen.has(child.nodeId)) {
			seen.add(child.nodeId);
			children.push(child);
		}
	}
	return children;
}

function normalizeText(value: unknown): string {
	return String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

function splitText(value: unknown, max = 700): string[] {
	const text = normalizeText(value);
	if (!text) return [];
	const parts: string[] = [];
	for (let start = 0; start < text.length; start += max) {
		parts.push(text.slice(start, start + max));
	}
	return parts;
}

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
	const nodes = response["nodes"].map(axNode);
	const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
	const childrenByParent = new Map<string, AxNode[]>();
	for (const node of nodes) {
		if (!node.parentId) continue;
		const children = childrenByParent.get(node.parentId) ?? [];
		children.push(node);
		childrenByParent.set(node.parentId, children);
	}

	elementRefs.clear();
	type InternalLine = SnapshotLine & { kind: string };
	const lines: InternalLine[] = [];
	const elements: SnapshotElement[] = [];
	const visited = new Set<string>();
	const nextElementId = () => {
		const id = NEXT_ELEMENT_IDS.get(elementRefs) ?? 1;
		if (!Number.isSafeInteger(id)) {
			throw new Error("Element id limit reached; restart the tab bridge");
		}
		NEXT_ELEMENT_IDS.set(elementRefs, id + 1);
		return id;
	};
	const addLine = (text: string, element?: SnapshotElement, kind = "text") => {
		for (const part of splitText(text)) {
			lines.push({
				line: lines.length + 1,
				text: part,
				kind,
				...(element ? { element_id: element.id } : {}),
			});
		}
	};
	const addStaticText = (text: string) => {
		const normalized = normalizeText(text);
		if (!normalized) return;
		const previous = lines.at(-1);
		if (
			previous?.kind === "text" &&
			previous.text.length + normalized.length + 1 <= 700
		) {
			previous.text += ` ${normalized}`;
			return;
		}
		addLine(normalized);
	};
	const visit = (node: AxNode | undefined, parentName = ""): void => {
		if (!node || visited.has(node.nodeId)) return;
		visited.add(node.nodeId);
		const role = String(node.role?.value ?? "");
		const name = normalizeText(node.name?.value ?? "");
		const value = node.value?.value;
		let renderedName = parentName;
		if (!node.ignored && shouldShow(node)) {
			if (INTERACTIVE_ROLES.has(role) && node.backendDOMNodeId) {
				const element: SnapshotElement = {
					id: nextElementId(),
					role,
					...(name ? { name } : {}),
					...(value === "" || value == null ? {} : { value }),
				};
				elementRefs.set(element.id, node.backendDOMNodeId);
				elements.push(element);
				addLine(
					`[${element.id}] ${role}${name ? ` ${name}` : ""}${
						value === "" || value == null ? "" : ` = ${JSON.stringify(value)}`
					}`,
					element,
					"interactive",
				);
				renderedName = name;
			} else if (role === "StaticText") {
				if (name && name !== parentName) addStaticText(name);
			} else if (role === "heading" || role === "image") {
				if (name) addLine(`${role}: ${name}`, undefined, role);
				renderedName = name || parentName;
			}
		}
		for (const child of orderedChildren(node, nodesById, childrenByParent)) {
			visit(child, renderedName);
		}
	};

	for (const root of nodes.filter(
		(node) => !node.parentId || !nodesById.has(node.parentId),
	)) {
		visit(root);
	}
	for (const node of nodes) visit(node);

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
