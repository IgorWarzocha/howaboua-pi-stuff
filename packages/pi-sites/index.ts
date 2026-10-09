import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getSitesAuth } from "./src/auth.js";
import { SitesClient } from "./src/client.mjs";
import { call, documentation } from "./src/facade.mjs";
import { boundedJson } from "./src/redact.mjs";

async function result(run: () => Promise<unknown>) {
	try {
		const value = await run();
		const text = typeof value === "string" ? value : boundedJson(value);
		if (text.startsWith("{")) {
			const parsed = JSON.parse(text);
			if (parsed.ok === false) {
				throw Object.assign(new Error(parsed.error.message), parsed.error);
			}
		}
		return { content: [{ type: "text" as const, text }], details: undefined };
	} catch (error) {
		const info = error instanceof Error ? error : new Error(String(error));
		const fields = info as Error & {
			code?: string;
			topic?: string;
			termsUrl?: string;
			status?: number;
			details?: unknown;
		};
		throw new Error(
			boundedJson({
				ok: false,
				error: {
					code: fields.code ?? "sites_error",
					message: info.message,
					topic: fields.topic,
					terms_url: fields.termsUrl,
					status: fields.status,
					details: fields.details,
				},
			}),
		);
	}
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
