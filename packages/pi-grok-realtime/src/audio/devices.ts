import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { audioEnvironment, audioHelperPath } from "./helper.ts";

const execute = promisify(execFile);

/** Enumerate only when a user opens the native device picker. */
export async function listAudioDevices(
	kind: "microphone" | "speaker",
): Promise<{ name: string; description: string }[]> {
	try {
		const { stdout } = await execute(audioHelperPath(), ["--devices"], {
			env: audioEnvironment(),
			maxBuffer: Number.POSITIVE_INFINITY,
		});
		const value: unknown = JSON.parse(stdout);
		if (!value || typeof value !== "object")
			throw new Error("Invalid device list");
		const devices: unknown = Reflect.get(
			value,
			kind === "microphone" ? "microphones" : "speakers",
		);
		if (!Array.isArray(devices)) throw new Error("Invalid device list");
		return devices.map((device: unknown) => {
			if (
				!device ||
				typeof device !== "object" ||
				!("name" in device) ||
				typeof device.name !== "string" ||
				!("description" in device) ||
				typeof device.description !== "string"
			)
				throw new Error("Invalid device entry");
			return { name: device.name, description: device.description };
		});
	} catch (error) {
		throw new Error(
			`Could not list audio devices: ${error instanceof Error ? error.message : String(error)}. The saved device is unchanged`,
			{ cause: error },
		);
	}
}
