import { join, resolve } from "node:path";
import {
	loadBundle,
	readAsset,
	type TabBundle,
	type TabFilter,
} from "./bundle.ts";
import { TabCollector, type TabSnapshot, type TabStatus } from "./collector.ts";
import { TabQueries, TabQueryError } from "./query.ts";

export type { TabSnapshot } from "./collector.ts";

export interface CustomTab {
	id: string;
	title: string;
	entry: string;
	filters: TabFilter[];
	status: TabStatus;
}

export interface TabCatalog {
	tabs: CustomTab[];
	errors: string[];
}

export interface CustomTabs {
	list(): TabCatalog;
	get(id: string): TabSnapshot | undefined;
	query(id: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
	asset(
		id: string,
		path: string,
	): Promise<{ data: Buffer; type: string } | undefined>;
	start(): void;
	once(): Promise<void>;
	pause(): Promise<void>;
	close(): Promise<void>;
}

export async function createCustomTabs(
	paths: string[],
	options: { stateRoot: string; sessions: string },
): Promise<CustomTabs> {
	const stateRoot = resolve(options.stateRoot);
	const sessions = resolve(options.sessions);
	const errors: string[] = [];
	const bundles: TabBundle[] = [];
	for (const path of paths) {
		try {
			bundles.push(await loadBundle(path));
		} catch (error) {
			errors.push(
				`Custom tab bundle ${path} is disabled: ${String(error)}. Check its tab.json and web/ entry.`,
			);
		}
	}
	const counts = new Map<string, number>();
	for (const bundle of bundles)
		counts.set(bundle.manifest.id, (counts.get(bundle.manifest.id) ?? 0) + 1);
	const tabs = new Map<
		string,
		{ bundle: TabBundle; collector: TabCollector; queries: TabQueries }
	>();
	for (const bundle of bundles) {
		const id = bundle.manifest.id;
		if (counts.get(id) !== 1) {
			errors.push(
				`Custom tab bundle ${bundle.root} is disabled: duplicate id "${id}". Give enabled bundles unique ids.`,
			);
			continue;
		}
		if (process.platform === "win32") {
			errors.push(
				`Custom tab "${id}" is disabled: collectors require POSIX process groups and are not supported on Windows.`,
			);
			continue;
		}
		try {
			const collector = new TabCollector(bundle, join(stateRoot, id), sessions);
			await collector.initialise(stateRoot);
			tabs.set(id, {
				bundle,
				collector,
				queries: new TabQueries(bundle, join(stateRoot, id), sessions),
			});
		} catch (error) {
			errors.push(
				`Custom tab "${id}" is disabled: ${String(error)}. Check the tab state directory.`,
			);
		}
	}
	let closed = false;
	return {
		list: () => ({
			tabs: [...tabs.values()].map(({ bundle: { manifest }, collector }) => ({
				id: manifest.id,
				title: manifest.title,
				entry: `/tabs/${manifest.id}/${manifest.entry.split("/").map(encodeURIComponent).join("/")}`,
				filters: [...manifest.filters],
				status: collector.snapshot().status,
			})),
			errors: [...errors],
		}),
		get: (id) => tabs.get(id)?.collector.snapshot(),
		query: async (id, input, signal) => {
			if (closed)
				throw new TabQueryError(
					503,
					"Observatory is closing. Retry after restarting.",
				);
			const tab = tabs.get(id);
			if (!tab)
				throw new TabQueryError(404, "This custom tab is missing or disabled.");
			return tab.queries.query(input, signal);
		},
		asset: async (id, path) => {
			const tab = tabs.get(id);
			return tab ? readAsset(tab.bundle, path) : undefined;
		},
		start: () => {
			if (!closed) for (const { collector } of tabs.values()) collector.start();
		},
		once: async () => {
			if (!closed)
				await Promise.all(
					[...tabs.values()].map(({ collector }) => collector.once()),
				);
		},
		pause: async () => {
			await Promise.all(
				[...tabs.values()].map(({ collector }) => collector.pause()),
			);
		},
		close: async () => {
			closed = true;
			await Promise.all(
				[...tabs.values()].flatMap(({ collector, queries }) => [
					collector.close(),
					queries.close(),
				]),
			);
		},
	};
}
