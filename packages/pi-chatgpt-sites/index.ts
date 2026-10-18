import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

export default async function sitesExtension(pi: ExtensionAPI) {
	const sites = defineTool({
		name: "sites",
		label: "Sites",
		description: "Manage ChatGPT Sites",
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
	const guide = defineTool({
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
	const tools = [
		{
			tool: sites,
			gpt: "Manage ChatGPT Sites",
			ordinary: sites.description,
		},
		{
			tool: guide,
			gpt: "Sites guide or live resource.action parameter schema",
			ordinary: guide.description,
		},
	];
	for (const { tool } of tools) pi.registerTool(tool);
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(pi, () =>
			tools.map(({ tool }) =>
				adaptToolForCodeMode(tool, {
					discovery: "help",
					deferLoading: true,
				}),
			),
		);
		pi.on("session_shutdown", () => registration.unregister());
		const { registerGptPromptMode } = await import(
			"@howaboua/pi-codex-conversion/prompt-mode"
		);
		registerGptPromptMode(pi, (active) => {
			for (const { tool, gpt, ordinary } of tools) {
				const description = active ? gpt : ordinary;
				if (tool.description !== description) {
					tool.description = description;
					pi.registerTool(tool);
				}
			}
			return tools.map(({ tool }) => tool);
		});
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			![
				"ERR_MODULE_NOT_FOUND",
				"MODULE_NOT_FOUND",
				"ERR_PACKAGE_PATH_NOT_EXPORTED",
			].includes(String(error.code)) ||
			!error.message.includes("@howaboua/pi-codex-conversion")
		)
			throw error;
	}
}
