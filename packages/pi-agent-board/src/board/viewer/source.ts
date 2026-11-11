import { isAbsolute } from "node:path";
import type { ViewSource } from "./contracts.ts";

export function parseSource(value: unknown): ViewSource {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid viewer source");
	const fields = value as Record<string, unknown>;
	const required = (key: string) => {
		const field = fields[key];
		if (
			typeof field !== "string" ||
			!field.length ||
			field.length > 4096 ||
			field.includes("\0")
		)
			throw new Error(`Invalid viewer ${key}`);
		return field;
	};
	const folder = required("folder");
	const databasePath = required("databasePath");
	if (!isAbsolute(folder) || !isAbsolute(databasePath))
		throw new Error("Viewer source paths must be absolute");
	const sessionName = fields["sessionName"];
	if (sessionName !== null && typeof sessionName !== "string")
		throw new Error("Invalid viewer session name");
	return {
		sessionId: required("sessionId"),
		boardId: required("boardId"),
		sessionName,
		folder,
		databasePath,
	};
}
