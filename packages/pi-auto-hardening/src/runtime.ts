import { DISABLED_ENV, ROLE_ENV, WORKER_ROLE } from "./constants.js";

export type RuntimeRole = "controller" | "disabled" | "worker";

export function resolveRuntimeRole(env: NodeJS.ProcessEnv): RuntimeRole {
	if (env[ROLE_ENV] === WORKER_ROLE) return "worker";
	if (env[DISABLED_ENV] === "1") return "disabled";
	return "controller";
}

export function suppressDescendantHardening(env: NodeJS.ProcessEnv): void {
	delete env[ROLE_ENV];
	env[DISABLED_ENV] = "1";
}
