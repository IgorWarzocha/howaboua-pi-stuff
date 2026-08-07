import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { DEFAULT_CONFIG, type SemanticGrepConfig } from "../src/config.js";
import { dbPathFor, getMeta, openIndexDb } from "../src/db.js";
import { discoverFiles } from "../src/discovery.js";
import { chunkSnapshot } from "../src/files.js";
import { runIndex } from "../src/index-runner.js";
import { syncIndex } from "../src/indexer.js";
import { tryAcquireIndexLock } from "../src/lock.js";
import { searchDb } from "../src/search.js";

function tempProject(): string {
	const root = mkdtempSync(path.join(tmpdir(), "semantic-grep-test-"));
	writeFileSync(path.join(root, "package.json"), "{}\n");
	return root;
}

function config(url: string): SemanticGrepConfig {
	const value = structuredClone(DEFAULT_CONFIG);
	value.embeddings.url = url;
	value.embeddings.model = "test-embedding";
	value.embeddings.batchSize = 8;
	value.indexing.includeExtensions = [".ts"];
	value.indexing.maxEmbeddingChars = 1_000;
	return value;
}

interface Endpoint {
	url: string;
	state: {
		bodies: Array<Record<string, unknown>>;
		fail: boolean;
		failAfterInputs?: number;
		inputs: number;
	};
	close(): Promise<void>;
}

async function embeddingEndpoint(): Promise<Endpoint> {
	const state: Endpoint["state"] = { bodies: [], fail: false, inputs: 0 };
	const server: Server = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) raw += chunk;
		if (
			state.fail ||
			(state.failAfterInputs !== undefined &&
				state.inputs >= state.failAfterInputs)
		) {
			response.writeHead(503).end("deliberate failure");
			return;
		}
		const body = JSON.parse(raw) as { input: string | string[] };
		state.bodies.push(body);
		const inputs = Array.isArray(body.input) ? body.input : [body.input];
		state.inputs += inputs.length;
		response.writeHead(200, { "Content-Type": "application/json" }).end(
			JSON.stringify({
				data: inputs.map((input, index) => ({
					index,
					embedding: [input.length, index + 1, 1],
				})),
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("test embedding endpoint did not bind a TCP port");
	return {
		url: `http://127.0.0.1:${address.port}/v1/embeddings`,
		state,
		close: () =>
			new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}

test("unchanged and metadata-only files do not request new embeddings", async () => {
	const endpoint = await embeddingEndpoint();
	try {
		const root = tempProject();
		const file = path.join(root, "feature.ts");
		writeFileSync(file, "export const durableBehavior = 'first version';\n");
		const db = openIndexDb(root);
		const cfg = config(endpoint.url);
		await syncIndex(db, root, cfg);
		const initialInputs = endpoint.state.inputs;

		const unchanged = await syncIndex(db, root, cfg);
		assert.equal(unchanged.unchanged, 1);
		assert.equal(endpoint.state.inputs, initialInputs);

		const future = new Date(Date.now() + 2_000);
		utimesSync(file, future, future);
		const touched = await syncIndex(db, root, cfg);
		assert.equal(touched.metadataOnly, 1);
		assert.equal(endpoint.state.inputs, initialInputs);

		writeFileSync(file, "export const durableBehavior = 'second version';\n");
		utimesSync(file, future, future);
		const changed = await syncIndex(db, root, cfg);
		assert.equal(changed.changed, 1);
		assert.ok(endpoint.state.inputs > initialInputs);
		db.close();
	} finally {
		await endpoint.close();
	}
});

test("failed embeddings preserve the last complete file index", async () => {
	const endpoint = await embeddingEndpoint();
	try {
		const root = tempProject();
		const file = path.join(root, "stable.ts");
		const removed = path.join(root, "removed.ts");
		writeFileSync(file, "export function stableResult() { return 'old'; }\n");
		writeFileSync(removed, "export const removedAfterSuccess = true;\n");
		const db = openIndexDb(root);
		const cfg = config(endpoint.url);
		await syncIndex(db, root, cfg);
		const before = db
			.prepare("select hash, chunk_count from files where file = 'stable.ts'")
			.get();
		const chunksBefore = db
			.prepare("select text, vector from chunks where file = 'stable.ts'")
			.all();

		writeFileSync(file, "export function stableResult() { return 'new'; }\n");
		unlinkSync(removed);
		endpoint.state.fail = true;
		await assert.rejects(syncIndex(db, root, cfg), /503/);
		assert.deepEqual(
			db
				.prepare("select hash, chunk_count from files where file = 'stable.ts'")
				.get(),
			before,
		);
		assert.deepEqual(
			db
				.prepare("select text, vector from chunks where file = 'stable.ts'")
				.all(),
			chunksBefore,
		);
		assert.deepEqual(
			db.prepare("select file from files where file = 'removed.ts'").get(),
			{ file: "removed.ts" },
		);
		db.close();
	} finally {
		await endpoint.close();
	}
});

test("interrupted configuration rebuilds resume completed files", async () => {
	const endpoint = await embeddingEndpoint();
	try {
		const root = tempProject();
		writeFileSync(
			path.join(root, "a.ts"),
			"export const firstContract = 'stable';\n",
		);
		writeFileSync(
			path.join(root, "b.ts"),
			"export const secondContract = 'stable';\n",
		);
		const db = openIndexDb(root);
		const initialConfig = config(endpoint.url);
		await syncIndex(db, root, initialConfig);
		const initialInputs = endpoint.state.inputs;

		const changedConfig = config(endpoint.url);
		changedConfig.embeddings.documentPrefix = "document: ";
		changedConfig.embeddings.batchSize = 1;
		endpoint.state.failAfterInputs = initialInputs + 1;
		await assert.rejects(syncIndex(db, root, changedConfig), /503/);
		assert.deepEqual(
			db.prepare("select index_generation from files order by file").all(),
			[{ index_generation: 1 }, { index_generation: 1 }],
		);
		assert.deepEqual(
			db
				.prepare("select index_generation from staged_files order by file")
				.all(),
			[{ index_generation: 2 }],
		);

		endpoint.state.failAfterInputs = undefined;
		const beforeResume = endpoint.state.inputs;
		await syncIndex(db, root, changedConfig);
		assert.equal(endpoint.state.inputs - beforeResume, 1);
		assert.deepEqual(
			db.prepare("select index_generation from files order by file").all(),
			[{ index_generation: 2 }, { index_generation: 2 }],
		);
		db.close();
	} finally {
		await endpoint.close();
	}
});

test("query and document requests preserve configured embedding roles", async () => {
	const endpoint = await embeddingEndpoint();
	try {
		const root = tempProject();
		writeFileSync(
			path.join(root, "roles.ts"),
			"export const retrievalRole = 'document';\n",
		);
		const db = openIndexDb(root);
		const cfg = config(endpoint.url);
		cfg.embeddings.dimensions = 3;
		cfg.embeddings.documentPrefix = "doc: ";
		cfg.embeddings.queryPrefix = "query: ";
		cfg.embeddings.documentExtraBody = { input_type: "document" };
		cfg.embeddings.queryExtraBody = { input_type: "query" };
		await syncIndex(db, root, cfg);
		await searchDb(db, "retrieval role", 1, cfg);

		const documentRequest = endpoint.state.bodies.find(
			(body) => body["input_type"] === "document",
		);
		const queryRequest = endpoint.state.bodies.find(
			(body) => body["input_type"] === "query",
		);
		assert.equal(documentRequest?.["dimensions"], 3);
		assert.ok(
			(Array.isArray(documentRequest?.["input"])
				? documentRequest?.["input"][0]
				: documentRequest?.["input"]
			)?.startsWith("doc: File:"),
		);
		assert.equal(queryRequest?.["input"], "query: retrieval role");
		db.close();
	} finally {
		await endpoint.close();
	}
});

test("writer locks exclude concurrent indexers and recover after release", async () => {
	const root = tempProject();
	const release = await tryAcquireIndexLock(root);
	assert.ok(release);
	assert.equal(await tryAcquireIndexLock(root), undefined);
	await release?.();
	const reacquired = await tryAcquireIndexLock(root);
	assert.ok(reacquired);
	await reacquired?.();
});

test("legacy databases migrate without discarding indexed chunks", () => {
	const root = tempProject();
	mkdirSync(path.join(root, ".pi"), { recursive: true });
	const legacy = new Database(dbPathFor(root));
	legacy.exec(`
    create table meta (key text primary key, value text not null);
    create table files (
      file text primary key, hash text not null, size integer not null,
      mtime_ms real not null, indexed_at text not null
    );
    create table chunks (
      id integer primary key, file text not null, start_line integer not null,
      end_line integer not null, text text not null, hash text not null,
      vector text not null,
      foreign key(file) references files(file) on delete cascade
    );
    insert into meta values ('index_fingerprint', 'legacy-fingerprint');
    insert into files values ('legacy.ts', 'hash', 42, 1, 'then');
    insert into chunks (file, start_line, end_line, text, hash, vector)
      values ('legacy.ts', 1, 2, 'legacy indexed text', 'hash', '[1,2,3]');
  `);
	legacy.close();

	const migrated = openIndexDb(root);
	const file = migrated
		.prepare(
			"select index_fingerprint, index_generation, chunk_count from files where file = 'legacy.ts'",
		)
		.get() as {
		index_fingerprint: string;
		index_generation: number;
		chunk_count: number;
	};
	assert.deepEqual(file, {
		index_fingerprint: "legacy-fingerprint",
		index_generation: 1,
		chunk_count: 1,
	});
	assert.equal(getMeta(migrated, "active_fingerprint"), "legacy-fingerprint");
	assert.deepEqual(
		migrated.prepare("select count(*) count from chunks").get(),
		{
			count: 1,
		},
	);
	migrated.close();
});

test("Git discovery includes untracked files and honors standard ignores", async () => {
	const root = tempProject();
	execFileSync("git", ["init", "-q", root]);
	mkdirSync(path.join(root, "ignored"));
	mkdirSync(path.join(root, "node_modules"));
	writeFileSync(path.join(root, ".gitignore"), "ignored/\n");
	writeFileSync(path.join(root, "kept.ts"), "export const kept = true;\n");
	writeFileSync(path.join(root, "ignored", "hidden.ts"), "hidden\n");
	writeFileSync(path.join(root, "node_modules", "forced.ts"), "forced\n");
	execFileSync("git", ["-C", root, "add", "-f", "node_modules/forced.ts"]);

	const cfg = config("http://127.0.0.1:1/v1/embeddings");
	const result = await discoverFiles(root, cfg);
	assert.equal(result.source, "git");
	assert.deepEqual(
		result.files.map((file) => file.file),
		["kept.ts"],
	);
});

test("filesystem discovery applies nested gitignore rules", async () => {
	const root = tempProject();
	mkdirSync(path.join(root, "catalogue"));
	writeFileSync(path.join(root, "catalogue", ".gitignore"), "ignored.ts\n");
	writeFileSync(
		path.join(root, "catalogue", "kept.ts"),
		"export const kept = true;\n",
	);
	writeFileSync(path.join(root, "catalogue", "ignored.ts"), "ignored\n");

	const result = await discoverFiles(
		root,
		config("http://127.0.0.1:1/v1/embeddings"),
	);
	assert.equal(result.source, "filesystem");
	assert.deepEqual(
		result.files.map((file) => file.file),
		[path.join("catalogue", "kept.ts")],
	);
});

test("discovery honors startup cancellation", async () => {
	const root = tempProject();
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		discoverFiles(
			root,
			config("http://127.0.0.1:1/v1/embeddings"),
			controller.signal,
		),
		(error: Error) => error.name === "AbortError",
	);
});

test("startup indexing yields before project scanning", async () => {
	const endpoint = await embeddingEndpoint();
	try {
		const root = tempProject();
		writeFileSync(
			path.join(root, "background.ts"),
			"export const ready = true;\n",
		);
		let scanning = false;
		const indexing = runIndex(
			root,
			config(endpoint.url),
			false,
			undefined,
			() => {
				scanning = true;
			},
		);
		assert.equal(scanning, false);
		assert.equal((await indexing).status, "indexed");
	} finally {
		await endpoint.close();
	}
});

test("oversized repeated segments receive distinct chunk keys", () => {
	const cfg = config("http://127.0.0.1:1/v1/embeddings");
	cfg.indexing.maxEmbeddingChars = 20;
	cfg.indexing.maxChunkChars = 20;
	const chunks = chunkSnapshot(
		{
			file: "generated.ts",
			size: 40,
			mtimeMs: 1,
			ctimeMs: 1,
			hash: "file-hash",
			text: "abcdefghijklmnopqrstabcdefghijklmnopqrst",
		},
		cfg,
	);
	assert.equal(chunks.length, 2);
	assert.equal(new Set(chunks.map((chunk) => chunk.key)).size, 2);
});
