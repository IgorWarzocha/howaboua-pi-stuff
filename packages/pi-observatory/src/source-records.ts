import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type Database from "better-sqlite3";
import { displayValue, object, textContent } from "./normalise.ts";

type Path = (string | number | { parse: true })[];
type Recipe =
	| { path: Path }
	| { literal: unknown }
	| { array: Recipe[] }
	| { fields: [string, Recipe][] };
interface Context {
	record: unknown;
	file: number;
	line: number;
	paths: Map<unknown, Path>;
}
const contexts = new WeakMap<Database.Database, Context>();

export function withSource<T>(
	db: Database.Database,
	file: number,
	line: number,
	record: unknown,
	run: () => T,
): T {
	const previous = contexts.get(db);
	const paths = new Map<unknown, Path>();
	function visit(value: unknown, path: Path): void {
		if (!paths.has(value)) paths.set(value, path);
		if (Array.isArray(value))
			value.forEach((item, i) => visit(item, [...path, i]));
		else if (value && typeof value === "object")
			for (const [key, item] of Object.entries(value))
				visit(item, [...path, key]);
	}
	visit(record, []);
	const data = object(object(record)["data"]);
	for (const key of ["result"]) {
		const raw = data[key];
		if (typeof raw === "string") {
			try {
				visit(JSON.parse(raw), ["data", key, { parse: true }]);
			} catch {
				/* Truncated live result remains raw evidence. */
			}
		}
	}
	contexts.set(db, { file, line, paths, record });
	try {
		return run();
	} finally {
		if (previous) contexts.set(db, previous);
		else contexts.delete(db);
	}
}

export function sourceRecipe(
	db: Database.Database,
	value: unknown,
	mode = "display",
): string {
	const context = contexts.get(db);
	if (!context)
		throw new Error("Source reference requires an indexed record context");
	function encode(item: unknown): Recipe {
		const path = context?.paths.get(item);
		if (path) return { path };
		if (Array.isArray(item)) return { array: item.map(encode) };
		if (item && typeof item === "object")
			return {
				fields: Object.entries(item)
					.filter(([, child]) => child !== undefined)
					.map(([key, child]) => [key, encode(child)]),
			};
		return { literal: item ?? null };
	}
	return JSON.stringify({
		file: context.file,
		line: context.line,
		mode,
		recipe: encode(value),
	});
}

export function readRecord(
	db: Database.Database,
	file: number,
	line: number,
): unknown {
	const row = db
		.prepare<
			[number, number],
			{
				path: string;
				identity: string;
				start: number;
				length: number;
				digest: string;
			}
		>(
			`SELECT f.path,f.identity,r.start,r.length,r.digest FROM source_records r JOIN files f ON f.id=r.file_id WHERE r.file_id=? AND r.line=?`,
		)
		.get(file, line);
	if (!row) throw new Error("Source record reference is missing");
	return readRange(row);
}

interface RecordRange {
	path: string;
	identity: string;
	start: number;
	length: number;
	digest: string;
}
function readRange(row: RecordRange): unknown {
	if (row.length === 0)
		throw new Error("Content was pruned from session history");
	const fd = openSync(row.path, "r");
	try {
		const info = fstatSync(fd);
		if (
			`${info.dev}:${info.ino}` !== row.identity ||
			info.size < row.start + row.length
		)
			throw new Error("Source file was replaced or shortened");
		if (row.length > 32 * 1024 * 1024)
			throw new Error("Source record exceeds read limit");
		const buffer = Buffer.allocUnsafe(row.length);
		let offset = 0;
		while (offset < buffer.length) {
			const count = readSync(
				fd,
				buffer,
				offset,
				buffer.length - offset,
				row.start + offset,
			);
			if (!count) throw new Error("Source record was shortened while reading");
			offset += count;
		}
		if (createHash("sha256").update(buffer).digest("hex") !== row.digest)
			throw new Error("Source record was rewritten");
		return JSON.parse(buffer.toString("utf8"));
	} finally {
		closeSync(fd);
	}
}

export function installSourceReader(db: Database.Database): void {
	db.function(
		"source_value",
		(
			encoded: unknown,
			path: unknown,
			identity: unknown,
			start: unknown,
			length: unknown,
			digest: unknown,
		) => {
			if (typeof encoded !== "string" || !encoded) return "";
			try {
				const ref = JSON.parse(encoded) as {
					file: number;
					line: number;
					mode: string;
					recipe: Recipe;
				};
				const active = contexts.get(db);
				const record =
					active?.file === ref.file && active.line === ref.line
						? active.record
						: readRange({
								path: String(path),
								identity: String(identity),
								start: Number(start),
								length: Number(length),
								digest: String(digest),
							});
				const parsed = new Map<string, unknown>();
				function parse(value: unknown): unknown {
					const raw = String(value);
					if (!parsed.has(raw)) parsed.set(raw, JSON.parse(raw));
					return parsed.get(raw);
				}
				function decode(recipe: Recipe): unknown {
					if ("path" in recipe) {
						let value: unknown = record;
						for (const key of recipe.path)
							value =
								typeof key === "object"
									? parse(value)
									: (value as Record<string | number, unknown>)[key];
						return value;
					}
					if ("literal" in recipe) return recipe.literal;
					if ("array" in recipe) return recipe.array.map(decode);
					return Object.fromEntries(
						recipe.fields.map(([key, child]) => [key, decode(child)]),
					);
				}
				const value = decode(ref.recipe);
				if (ref.mode === "raw")
					return typeof value === "string" ? value : JSON.stringify(value);
				if (ref.mode === "context")
					return textContent(
						object(object(record)["message"])["content"],
					).slice(0, 32768);
				return displayValue(value);
			} catch (error) {
				return `[Source unavailable: ${error instanceof Error ? error.message : String(error)}]`;
			}
		},
	);
}
