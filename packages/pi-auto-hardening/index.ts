import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerControllerMode } from "./src/controller.js";
import {
	resolveRuntimeRole,
	suppressDescendantHardening,
} from "./src/runtime.js";
import { registerWorkerMode } from "./src/worker.js";

export default function (pi: ExtensionAPI) {
	const role = resolveRuntimeRole(process.env);
	if (role === "disabled") return;
	if (role === "worker") {
		suppressDescendantHardening(process.env);
		registerWorkerMode(pi);
		return;
	}
	registerControllerMode(pi);
}
