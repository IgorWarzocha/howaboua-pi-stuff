import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
	sessionHooks,
	localOpenCodeClient,
} from "../integrations/session-plugin.mjs";

test("OpenCode server hooks cannot claim shared-server or full-TUI identity", () => {
	for (const args of [
		[],
		["serve"],
		["web"],
		["attach", "http://host"],
		["run", "--attach=http://host"],
		["run", "--attach", "http://host"],
		["serve", "--mini"],
		["--", "run"],
	])
		assert.equal(localOpenCodeClient(args), false);
});

test("selection cannot be taken by background, child, or deleted sessions", async () => {
	const previous = process.env.HC_TERMINAL_ID;
	process.env.HC_TERMINAL_ID = "t1z";
	let ref;
	const hooks = sessionHooks("opencode", async (_agent, labels) => {
		ref = labels["herdr.state.ref"];
	});
	if (previous === undefined) delete process.env.HC_TERMINAL_ID;
	else process.env.HC_TERMINAL_ID = previous;
	const event = (type, info) =>
		hooks.event({ event: { type, properties: { info } } });
	const message = (sessionID) => hooks["chat.message"]({ sessionID });

	await event("session.created", { id: "background" });
	await event("session.updated", { id: "unselected" });
	await event("session.created", { id: "child", parentID: "root" });
	await message("child");
	assert.equal(ref, undefined);

	await message("root");
	await event("session.updated", { id: "background" });
	assert.equal(ref, '{"kind":"id","value":"root"}');
	await message("selected-B");
	await event("session.deleted", { id: "root" });
	assert.equal(ref, '{"kind":"id","value":"selected-B"}');
	await event("session.deleted", { id: "selected-B" });
	assert.equal(ref, "");
});

test("Pi ephemeral sessions suppress stale identity and stale shutdown cannot clear a newer session", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "herdr-plugins-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const state = join(dir, "state.json");
	writeFileSync(
		join(dir, "hc"),
		[
			`#!${process.execPath}`,
			"const fs=require('node:fs');const rl=require('node:readline').createInterface({input:process.stdin});",
			'rl.on("line",line=>{const request=JSON.parse(line);let result={};',
			'if(request.method==="terminal.get")result={pid:Number(process.env.TEST_ROOT),state:"live",labels:JSON.parse(fs.readFileSync(process.env.TEST_STATE,"utf8"))};',
			'else {const labels=request.params.labels;const old=JSON.parse(fs.readFileSync(process.env.TEST_STATE,"utf8"));fs.writeFileSync(process.env.TEST_STATE,JSON.stringify(Object.fromEntries(Object.entries({...old,...labels}).filter(([,value])=>value!==""))));}',
			"console.log(JSON.stringify({id:request.id,result}));});",
		].join("\n"),
		{ mode: 0o755 },
	);
	writeFileSync(
		state,
		JSON.stringify({
			"herdr.state.owner": "99999999",
			"herdr.state.agent": "pi",
			"herdr.state.ref": '{"kind":"id","value":"old"}',
			"pi.session_file": "/tmp/legacy.jsonl",
		}),
	);
	const piScript = join(dir, "pi");
	writeFileSync(
		piScript,
		[
			`import extension from ${JSON.stringify(new URL("../integrations/pi.ts", import.meta.url).href)};`,
			"import fs from 'node:fs';",
			"async function runtime(){const events=new Map();await extension({on:(event,callback)=>events.set(event,callback)});return events;}",
			'const read=()=>JSON.parse(fs.readFileSync(process.env.TEST_STATE,"utf8"));',
			"const ctx=file=>({sessionManager:{getSessionFile:()=>file}});",
			'const first=await runtime();await first.get("session_start")({},ctx());const ephemeral=read();',
			'await first.get("session_shutdown")();const ended=read();',
			'await first.get("session_start")({},ctx("/tmp/pi-A.jsonl"));',
			'const second=await runtime();await second.get("session_start")({},ctx("/tmp/pi-B.jsonl"));',
			'await first.get("session_shutdown")();const newer=read();',
			'await second.get("session_shutdown")();console.log(JSON.stringify({pid:process.pid,ephemeral,ended,newer,final:read()}));',
		].join("\n"),
	);
	const piRun = spawnSync(process.execPath, [piScript], {
		env: {
			...process.env,
			HC_TERMINAL_ID: "t1z",
			HERDR_STATE_HC: join(dir, "hc"),
			TEST_STATE: state,
			TEST_ROOT: String(process.pid),
		},
		encoding: "utf8",
	});
	assert.equal(piRun.status, 0, piRun.stderr);
	const piState = JSON.parse(piRun.stdout);
	assert.equal(piState.ephemeral["herdr.state.ephemeral"], "1");
	assert.equal(piState.ephemeral["herdr.state.owner"], String(piState.pid));
	assert.equal(piState.ephemeral["herdr.state.ref"] ?? "", "");
	assert.equal(piState.ephemeral["pi.session_file"], "/tmp/legacy.jsonl");
	assert.equal(piState.ended["herdr.state.ephemeral"] ?? "", "");
	assert.equal(
		piState.newer["herdr.state.ref"],
		'{"kind":"path","value":"/tmp/pi-B.jsonl"}',
	);
	assert.equal(piState.final["herdr.state.owner"] ?? "", "");
});
