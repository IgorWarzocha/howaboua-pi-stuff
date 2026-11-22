import test from "node:test";
import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { install } from "../scripts/install.mjs";

function fixture(t, commands = {}) {
	const home = mkdtempSync(join(tmpdir(), "herdr-install-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const bin = join(home, "fake-bin");
	mkdirSync(bin);
	for (const [command, behavior] of Object.entries(commands)) {
		const source =
			typeof behavior === "number" ? `process.exit(${behavior});` : behavior;
		writeFileSync(join(bin, command), `#!${process.execPath}\n${source}\n`, {
			mode: 0o755,
		});
	}
	const env = { HOME: home, PATH: bin };
	const put = (relative, value) => {
		const path = join(home, relative);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			typeof value === "string" ? value : JSON.stringify(value),
		);
		return path;
	};
	return {
		home,
		env,
		put,
		run: (overrides) => install({ home, env, ...overrides }),
	};
}

test("installation preserves user settings and permissions and does not rewrite them on repeat", (t) => {
	const f = fixture(t, { claude: 0 });
	const settings = f.put(".claude/settings.json", {
		theme: "dark",
		hooks: {
			Stop: [{ command: "user-stop" }],
			SessionStart: [{ hooks: [{ command: "user-start" }] }],
		},
	});
	chmodSync(settings, 0o640);
	f.run();
	const merged = JSON.parse(readFileSync(settings, "utf8"));
	assert.deepEqual(merged.hooks.Stop, [{ command: "user-stop" }]);
	assert.equal(merged.hooks.SessionStart.length, 2);
	assert.equal(merged.theme, "dark");
	assert.equal(statSync(settings).mode & 0o777, 0o640);
	const mtime = statSync(settings).mtimeMs;
	f.run();
	assert.equal(statSync(settings).mtimeMs, mtime);
	assert.equal(
		readdirSync(dirname(settings)).some((name) =>
			name.startsWith(".herdr-state-"),
		),
		false,
	);
});

test("unowned files, symlinks, malformed JSON and unsupported versions remain untouched", (t) => {
	const f = fixture(t, {
		pi: 0,
		claude: 0,
		cursor: 0,
		"cursor-agent": 0,
		droid: 0,
	});
	const wrapper = f.put(".local/bin/herdr-state", "#!/bin/sh\necho user\n");
	const source = f.put("user-settings.json", { user: true });
	const settings = join(f.home, ".claude/settings.json");
	mkdirSync(dirname(settings), { recursive: true });
	symlinkSync(source, settings);
	const pi = f.put(".pi/agent/extensions/herdr-state.ts", "// user extension");
	const cursor = f.put(".cursor/hooks.json", { version: 2, user: true });
	const droid = f.put(".factory/settings.json", "{ broken");
	const before = [wrapper, source, pi, cursor, droid].map((path) =>
		readFileSync(path, "utf8"),
	);
	const report = f.run();
	assert.deepEqual(
		[wrapper, source, pi, cursor, droid].map((path) =>
			readFileSync(path, "utf8"),
		),
		before,
	);
	assert.equal(lstatSync(settings).isSymbolicLink(), true);
	for (const agent of ["cli", "pi", "claude", "cursor", "droid"]) {
		assert.equal(
			report.skipped.some((item) => item.agent === agent),
			true,
			agent,
		);
	}
});

test("install never loads OMP into Pi's overridden agent directory", (t) => {
	const f = fixture(t, { pi: 0, omp: 0 });
	f.env.PI_CODING_AGENT_DIR = join(f.home, "custom-pi");
	f.put(".omp/agent/session-placeholder", "");
	const report = f.run();
	assert.match(
		readlinkSync(join(f.env.PI_CODING_AGENT_DIR, "extensions/herdr-state.ts")),
		/\/integrations\/pi\.ts$/,
	);
	assert.equal(
		existsSync(join(f.home, ".omp/agent/extensions/herdr-state.ts")),
		false,
	);
	assert.equal(
		report.warnings.some((value) => /shared with Pi/.test(value)),
		true,
	);
});

test("Codex hook installation respects the user's opt-out and leaves TOML untouched", (t) => {
	const behavior =
		'if (process.argv[2] === "features") console.log(process.env.FEATURES); process.exit(0);';
	const f = fixture(t, { codex: behavior });
	const config = f.put(
		".codex/config.toml",
		"[features]\nhooks = false # user choice\n",
	);
	f.env.FEATURES = "other stable true";
	assert.equal(
		f.run().warnings.some((value) => /not advertised/.test(value)),
		true,
	);
	f.env.FEATURES = "hooks under-development false";
	assert.equal(
		f.run().warnings.some((value) => /disabled/.test(value)),
		true,
	);
	assert.equal(existsSync(join(f.home, ".codex/hooks.json")), false);
	assert.equal(
		readFileSync(config, "utf8"),
		"[features]\nhooks = false # user choice\n",
	);
	f.env.FEATURES = "hooks under-development true";
	f.run();
	assert.equal(
		readFileSync(config, "utf8"),
		"[features]\nhooks = false # user choice\n",
	);
});

test("Kimi TOML appends a native hook without rewriting user settings", (t) => {
	const f = fixture(t, { kimi: 0 });
	const python = spawnSync(
		"python3",
		["-c", "import sys; print(sys.executable)"],
		{ encoding: "utf8" },
	);
	assert.equal(python.status, 0);
	symlinkSync(python.stdout.trim(), join(f.home, "fake-bin/python3"));
	const before = '# user choice\n[model]\nname = "mine"\n';
	const config = f.put(".kimi-code/config.toml", before);
	assert.equal(
		f.run().installed.some((item) => item.agent === "kimi"),
		true,
	);
	const once = readFileSync(config, "utf8");
	assert.ok(once.startsWith(before));
	assert.ok(once.includes('event = "SessionStart"'));
	assert.equal(
		f.run().installed.find((item) => item.agent === "kimi").changed,
		false,
	);
	assert.equal(readFileSync(config, "utf8"), once);
});

test("shared Codex hook registration is recognised without replacing its symlink", (t) => {
	const f = fixture(t, {
		codex: 'if(process.argv[2]==="features")console.log("hooks stable true")',
	});
	const command =
		'if [ -n "${HC_TERMINAL_ID:-}" ]; then "$HOME/.local/bin/herdr-state" capture codex; fi';
	const source = f.put("shared-hooks.json", {
		hooks: {
			SessionStart: [{ hooks: [{ type: "command", command, timeout: 10 }] }],
		},
	});
	const path = join(f.home, ".codex/hooks.json");
	mkdirSync(dirname(path), { recursive: true });
	symlinkSync(source, path);
	const before = readFileSync(source, "utf8");
	const report = f.run();
	assert.equal(
		report.installed.find((item) => item.agent === "codex").changed,
		false,
	);
	assert.equal(lstatSync(path).isSymbolicLink(), true);
	assert.equal(readFileSync(source, "utf8"), before);
});
