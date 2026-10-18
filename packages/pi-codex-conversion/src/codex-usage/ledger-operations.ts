import type { CodexSpend, UsageHistoryScan } from "./ledger-schema.ts";
import type { CodexUsageSnapshot } from "./payload.ts";

export type LedgerOperation =
	| { kind: "spend"; spend: CodexSpend; nonstandard: boolean }
	| { kind: "quota"; snapshot: CodexUsageSnapshot }
	| { kind: "manual-reset" }
	| { kind: "report" }
	| { kind: "reserve-history" }
	| { kind: "import-history"; history: UsageHistoryScan };

export interface LedgerRequest {
	key: string;
	at: number;
	path: string;
	gaps: number;
	operation: LedgerOperation;
}

export type LedgerResult =
	| { kind: "updated" }
	| { kind: "report"; lines: string[] }
	| { kind: "history"; start: number; to: number };
