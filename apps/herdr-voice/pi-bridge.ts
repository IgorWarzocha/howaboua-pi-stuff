// herdr-voice-managed-bridge v1
import {
	mkdir,
	readdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

const uuid =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function voiceBridge(pi: ExtensionAPI) {
	const agentDir = getAgentDir();
	const inbox = join(agentDir, "runtime", "herdr-voice-requests");
	const receipts = join(agentDir, "runtime", "voice-requests");
	const { HC_TERMINAL_ID: terminalId } = process.env;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let polling: Promise<void> | undefined;
	let stopped = false;
	const handled = new Set<string>();

	async function start(
		provider: string,
		requestId: string,
		ctx: ExtensionContext,
	) {
		if (
			stopped ||
			!uuid.test(requestId) ||
			!["grok", "gippity"].includes(provider) ||
			handled.has(requestId)
		)
			return;
		handled.add(requestId);
		const receipt = join(receipts, `${requestId}.json`);
		// Also cleans up requests whose caller disconnected before reading the receipt.
		const cleanup = setTimeout(() => {
			handled.delete(requestId);
			void unlink(receipt).catch(() => {});
		}, 90_000);
		cleanup.unref();
		if (
			!pi
				.getCommands()
				.some(
					(command) =>
						command.name === provider && command.source === "extension",
				)
		) {
			await mkdir(receipts, { recursive: true, mode: 0o700 });
			const temporary = `${receipt}.tmp`;
			await writeFile(
				temporary,
				JSON.stringify({
					version: 1,
					requestId,
					sessionId: ctx.sessionManager.getSessionId(),
					terminalId,
					provider,
					running: false,
					urls: [],
					error: `Install the ${provider} Pi extension and run /reload before starting voice.`,
				}),
				{ mode: 0o600 },
			);
			await rename(temporary, receipt);
			return;
		}
		// Expansion is required: without it this is model input, not a slash command.
		pi.sendUserMessage(`/${provider} server ensure ${requestId}`, {
			expandPromptTemplates: true,
		});
	}

	pi.registerCommand("herdr-voice-start", {
		description: "Start the selected voice server for Herdr",
		handler: async (args, ctx) => {
			const [provider, requestId] = args.trim().split(/\s+/);
			if (provider && requestId) await start(provider, requestId, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!terminalId) return;
		stopped = true;
		clearTimeout(timer);
		await polling;
		stopped = false;
		await mkdir(inbox, { recursive: true, mode: 0o700 });
		const result = await pi.exec("hc", [
			"label",
			terminalId,
			"herdr.voice=1",
			`herdr.voice.agent-dir=${agentDir}`,
			`herdr.voice.session=${ctx.sessionManager.getSessionId()}`,
		]);
		if (result.code !== 0) {
			ctx.ui.notify(
				"Herdr could not register this Pi pane. Check hc connectivity, then run /reload.",
				"error",
			);
			return;
		}
		async function poll() {
			try {
				for (const name of await readdir(inbox)) {
					if (!name.endsWith(".json") || !uuid.test(name.slice(0, -5)))
						continue;
					const path = join(inbox, name);
					let request: unknown;
					try {
						request = JSON.parse(await readFile(path, "utf8"));
					} catch {
						// Another pane may have consumed it; malformed owned requests cannot block the inbox.
						await unlink(path).catch(() => {});
						continue;
					}
					if (
						typeof request === "object" &&
						request &&
						"expiresAt" in request &&
						typeof request.expiresAt === "number" &&
						request.expiresAt < Date.now()
					) {
						await unlink(path);
						continue;
					}
					if (
						typeof request !== "object" ||
						!request ||
						!("sessionId" in request) ||
						request.sessionId !== ctx.sessionManager.getSessionId() ||
						!("terminalId" in request) ||
						request.terminalId !== terminalId
					)
						continue;
					await unlink(path);
					if (
						!("expiresAt" in request) ||
						typeof request.expiresAt !== "number" ||
						request.expiresAt < Date.now() ||
						!("provider" in request) ||
						typeof request.provider !== "string"
					)
						continue;
					await start(request.provider, name.slice(0, -5), ctx);
				}
			} catch (error) {
				ctx.ui.notify(
					`Herdr voice request failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			} finally {
				if (!stopped)
					timer = setTimeout(() => {
						polling = poll();
					}, 250);
			}
		}
		timer = setTimeout(() => {
			polling = poll();
		}, 250);
	});

	pi.on("session_shutdown", async () => {
		stopped = true;
		clearTimeout(timer);
		await polling;
		if (terminalId)
			await pi.exec("hc", [
				"label",
				terminalId,
				"herdr.voice=",
				"herdr.voice.agent-dir=",
				"herdr.voice.session=",
			]);
	});
}
