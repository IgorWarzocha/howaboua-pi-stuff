import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(
			"Invalid models.json object. Fix it before editing context windows.",
		);
	return value as ObjectValue;
}

export function contextWindowModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

function readDocument(path: string): ObjectValue {
	if (!existsSync(path)) return { providers: {} };
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
	} catch {
		throw new Error(
			"Could not read models.json as JSON. For commented configuration, edit contextWindow in your own models.json.",
		);
	}
	const document = object(parsed);
	object(document["providers"]);
	return document;
}

/** Pi's modelOverrides layer wins over native provider catalogs. Never edit custom model definitions. */
export function writeContextWindowOverride(
	modelId: string,
	tokens: number | undefined,
	path = contextWindowModelsPath(),
): void {
	if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens <= 0))
		throw new Error("Enter a positive whole token count.");
	const document = readDocument(path);
	const providers = object(document["providers"]);
	const provider = object(providers["openai-codex"] ?? {});
	const overrides = object(provider["modelOverrides"] ?? {});
	const override = object(overrides[modelId] ?? {});
	if (tokens === undefined) {
		if (override["contextWindow"] === undefined) return;
		delete override["contextWindow"];
		if (Object.keys(override).length === 0) delete overrides[modelId];
	} else {
		override["contextWindow"] = tokens;
		overrides[modelId] = override;
	}
	if (Object.keys(overrides).length > 0) provider["modelOverrides"] = overrides;
	else delete provider["modelOverrides"];
	if (Object.keys(provider).length > 0) providers["openai-codex"] = provider;
	else delete providers["openai-codex"];
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.context-window.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, {
			flag: "wx",
			mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o600,
		});
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}
