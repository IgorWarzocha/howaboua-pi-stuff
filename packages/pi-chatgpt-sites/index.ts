import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getSitesAuth } from "./src/auth.js";
import { SitesClient } from "./src/client.js";
import { call, documentation } from "./src/facade.js";
import { boundedJson } from "./src/redact.js";

async function result(run: () => Promise<unknown>) {
	try {
		const value = await run();
		const text = typeof value === "string" ? value : boundedJson(value);
		if (text.startsWith("{")) {
			const parsed: unknown = JSON.parse(text);
			if (
				isRecord(parsed) &&
				parsed["ok"] === false &&
				isRecord(parsed["error"])
			) {
				const info = parsed["error"];
				throw Object.assign(new Error(String(info["message"])), info);
			}
		}
		return { content: [{ type: "text" as const, text }], details: undefined };
	} catch (error) {
		const info = error instanceof Error ? error : new Error(String(error));
		throw new Error(
			boundedJson({
				ok: false,
				error: {
					code: "code" in info ? (info.code ?? "sites_error") : "sites_error",
					message: info.message,
					topic: "topic" in info ? info.topic : undefined,
					terms_url: "termsUrl" in info ? info.termsUrl : undefined,
					status: "status" in info ? info.status : undefined,
					details: "details" in info ? info.details : undefined,
				},
			}),
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export default function sitesExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "sites",
		label: "Sites",
		description:
			"Manage ChatGPT Sites. No arguments or action:help returns help",
		parameters: Type.Object(
			{
				resource: Type.Optional(Type.String()),
				action: Type.Optional(Type.String()),
				params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			},
			{ additionalProperties: false },
		),
		async execute(_id, args, signal, _onUpdate, ctx) {
			const client = new SitesClient({
				authProvider: () => getSitesAuth(ctx),
				signal,
			});
			return result(() =>
				Object.keys(args).length === 0 || args.action === "help"
					? documentation("index", client)
					: call(args, client, ctx.cwd, signal),
			);
		},
	});
	pi.registerTool({
		name: "sites_documentation",
		label: "Sites documentation",
		description: "Sites guide or current resource.action parameter schema",
		parameters: Type.Object(
			{ topic: Type.Optional(Type.String()) },
			{ additionalProperties: false },
		),
		async execute(_id, args, signal, _onUpdate, ctx) {
			return result(() =>
				documentation(
					args.topic === "help" ? "index" : args.topic,
					new SitesClient({ authProvider: () => getSitesAuth(ctx), signal }),
				),
			);
		},
	});
}
