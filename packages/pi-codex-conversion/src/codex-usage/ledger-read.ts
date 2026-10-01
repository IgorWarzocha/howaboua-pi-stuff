import { readFileSync } from "node:fs";
import { parseUsageLedger, type UsageLedger } from "./ledger-schema.ts";

export function readUsageLedgerFile(path: string): UsageLedger {
	try { return parseUsageLedger(JSON.parse(readFileSync(path, "utf8"))); }
	catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { version: 1, accounts: {} };
		throw error;
	}
}
