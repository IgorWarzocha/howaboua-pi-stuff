import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GippityRemoteApps,
	type GippityRemoteAppUpdate,
	registerGippityRemoteApp,
} from "../src/voice/lan/remote-app.ts";

test("remote miniapps register across load order and stay in their namespace", async () => {
	type Listener = (value: unknown) => void;
	const listeners = new Map<string, Set<Listener>>();
	const events = {
		emit(channel: string, value: unknown) {
			for (const listener of listeners.get(channel) ?? []) listener(value);
		},
		on(channel: string, listener: Listener) {
			const group = listeners.get(channel) ?? new Set<Listener>();
			group.add(listener);
			listeners.set(channel, group);
			return () => group.delete(listener);
		},
	};
	const root = await mkdtemp(join(tmpdir(), "gippity-remote-app-"));
	await mkdir(join(root, "assets"));
	await writeFile(join(root, "index.html"), "pet");
	await writeFile(join(root, "assets", "pet.js"), "pet");
	let publish: ((update: GippityRemoteAppUpdate) => void) | undefined;
	const pi = { events, on() {} } as Parameters<
		typeof registerGippityRemoteApp
	>[0];
	const registration = registerGippityRemoteApp(pi, {
		id: "pi-pet",
		root,
		snapshot: () => ({ revision: 1, action: "idle" }),
		subscribe(listener) {
			publish = listener;
			return () => {
				publish = undefined;
			};
		},
	});
	expect(registration.available).toBe(false);

	const apps = new GippityRemoteApps({ events } as ConstructorParameters<
		typeof GippityRemoteApps
	>[0]);
	expect(registration.available).toBe(true);
	expect(apps.apps()).toEqual([
		{ id: "pi-pet", path: "/_gippity/apps/pi-pet/" },
	]);
	expect(apps.snapshot()).toEqual({
		type: "app.state",
		app: "pi-pet",
		data: { revision: 1, action: "idle" },
	});
	expect(apps.route("/_gippity/apps/pi-pet")).toEqual({
		kind: "redirect",
		location: "/_gippity/apps/pi-pet/",
	});
	expect(apps.route("/_gippity/apps/pi-pet/assets/pet.js").kind).toBe("asset");
	expect(apps.route("/_gippity/apps/pi-pet/%2e%2e/index.html").kind).toBe(
		"missing",
	);
	expect(apps.route("/").kind).toBe("none");

	const messages: unknown[] = [];
	apps.onMessage((message) => messages.push(message));
	publish?.({ event: "wave", data: { count: 1 } });
	expect(messages).toEqual([
		{ type: "app.event", app: "pi-pet", event: "wave", data: { count: 1 } },
	]);
	registration.dispose();
	expect(apps.apps()).toEqual([]);
});
