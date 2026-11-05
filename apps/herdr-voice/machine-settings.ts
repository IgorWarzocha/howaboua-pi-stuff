import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DefaultPackageManager, getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

async function discover() {
	const agentDir = getAgentDir();
	const manager = new DefaultPackageManager({
		cwd: homedir(), agentDir,
		settingsManager: SettingsManager.create(homedir(), agentDir, { projectTrusted: false }),
	});
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), allowModelNetwork: false,
	});
	if (runtime.getError()) throw new Error(`Cannot read the host model catalogue: ${runtime.getError()}`);
	const models = runtime.getAvailableSnapshot().filter(model => model.input.includes("text"))
		.map(model => ({ provider: model.provider, modelId: model.id }));
	const packageRoots = manager.listConfiguredPackages()
		.filter(pkg => pkg.scope === "user" && pkg.installedPath)
		.map(pkg => pkg.installedPath);
	return { agentDir, models, packageRoots };
}

// Pi awaits explicit extension factories before model selection. No hooks, tools,
// prompts or sessions are registered; the private receipt owns success reporting.
export default async function () {
	const responsePath = process.env["HERDR_VOICE_SETTINGS_RESPONSE"];
	if (!responsePath) throw new Error("The host settings response path is missing");
	let response: { discovery: Awaited<ReturnType<typeof discover>> } | { error: string };
	try { response = { discovery: await discover() }; }
	catch (error) { response = { error: error instanceof Error ? error.message : String(error) }; }
	writeFileSync(responsePath, JSON.stringify(response), { mode: 0o600 });
}
