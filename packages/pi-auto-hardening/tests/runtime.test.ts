import { describe, expect, test } from "bun:test";
import { DISABLED_ENV, ROLE_ENV, WORKER_ROLE } from "../src/constants.js";
import {
	resolveRuntimeRole,
	suppressDescendantHardening,
} from "../src/runtime.js";

describe("runtime roles", () => {
	test("routes an ordinary process to the controller", () => {
		expect(resolveRuntimeRole({})).toBe("controller");
	});

	test("worker role outranks inherited suppression", () => {
		expect(
			resolveRuntimeRole({ [ROLE_ENV]: WORKER_ROLE, [DISABLED_ENV]: "1" }),
		).toBe("worker");
	});

	test("worker suppresses only hardening in descendants", () => {
		const env: NodeJS.ProcessEnv = {
			[ROLE_ENV]: WORKER_ROLE,
			UNRELATED_EXTENSION_SETTING: "kept",
		};
		suppressDescendantHardening(env);
		expect(env[ROLE_ENV]).toBeUndefined();
		expect(env[DISABLED_ENV]).toBe("1");
		expect(env["UNRELATED_EXTENSION_SETTING"]).toBe("kept");
		expect(resolveRuntimeRole(env)).toBe("disabled");
	});
});
