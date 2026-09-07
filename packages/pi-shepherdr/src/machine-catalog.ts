import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

export const LOCAL_MACHINE = "local";

const Machine = Type.Object({
	id: Type.String({ pattern: "^[a-f0-9]{32}$" }),
	label: Type.String({ minLength: 1, pattern: "^[^\\x00-\\x1f\\x7f]+$" }),
	target: Type.String({
		minLength: 1,
		pattern: "^[^-\\x00-\\x1f\\x7f][^\\x00-\\x1f\\x7f]*$",
	}),
	session: Type.String({
		minLength: 1,
		maxLength: 64,
		pattern: "^[a-zA-Z0-9_.-]+$",
	}),
	enabled: Type.Boolean(),
});
const Catalog = Type.Array(Machine);
export type SshMachine = Static<typeof Machine>;

export async function readMachineCatalog(): Promise<
	Record<string, SshMachine>
> {
	let stdout: string;
	try {
		({ stdout } = await promisify(execFile)(
			process.env["HERDR_BIN_PATH"]?.trim() || "herdr",
			["machine", "list", "--json"],
			{
				timeout: 10_000,
				maxBuffer: 1024 * 1024,
				encoding: "utf8",
			},
		));
	} catch (error) {
		throw new Error(
			`Could not read Herdr machines; requires Herdr 0.9 or newer: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(stdout);
	} catch {
		throw new Error("Herdr machine list returned invalid JSON");
	}
	if (
		!Check(Catalog, value) ||
		value.some((machine) => machine.session === "." || machine.session === "..")
	) {
		throw new Error("Herdr machine list returned an invalid catalog");
	}
	if (new Set(value.map((machine) => machine.id)).size !== value.length) {
		throw new Error("Herdr machine list returned duplicate profile IDs");
	}
	return Object.fromEntries(value.map((machine) => [machine.id, machine]));
}
