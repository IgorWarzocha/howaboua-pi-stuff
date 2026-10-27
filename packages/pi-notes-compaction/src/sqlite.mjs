import { createRequire } from "node:module";

// Only the shared SQLite surface used by Notes. Bun returns null for a missing
// row (better-sqlite3 returns undefined); blobs may be Uint8Array, not Buffer.
/** @template {unknown[]} P
 * @template R
 * @typedef {{get(...params:P): R | null | undefined; all(...params:P): R[]; run(...params:P): {changes:number; lastInsertRowid:number|bigint}}} Statement
 */
/** @template {unknown[]} P
 * @template R
 * @typedef {((...params:P) => R) & {immediate(...params:P):R}} Transaction
 */
/** @typedef {{
 * prepare<P extends unknown[] = unknown[], R = unknown>(sql:string): Statement<P,R>;
 * transaction<P extends unknown[], R>(fn:(...params:P) => R): Transaction<P,R>;
 * exec(sql:string):void;
 * close():void;
 * }} Database
 */

const require = createRequire(import.meta.url);

/** Avoid loading the native addon at all in Bun, including compiled Pi builds.
 * @param {string} path
 * @returns {Database}
 */
export function openDatabase(path) {
	/** @type {new(path:string) => Database} */
	const Database = process.versions["bun"]
		? require("bun:sqlite").Database
		: require("better-sqlite3");
	return new Database(path);
}
