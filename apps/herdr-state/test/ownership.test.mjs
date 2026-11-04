import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { nativeAgent, ownershipDecision } from '../src/ownership.mjs';

test('native recognition reads only executable and interpreter entrypoint, never later arguments', () => {
  assert.equal(nativeAgent(['/usr/bin/node', '/tmp/helper.mjs', 'pi', '--session', 'x']), null);
  assert.equal(nativeAgent(['/usr/bin/node', '-e', 'pi']), null);
  assert.equal(nativeAgent(['/usr/bin/node', '--require', '/tmp/pi', '/tmp/helper.mjs']), null);
  assert.equal(nativeAgent(['/usr/bin/node', '/opt/@earendil-works/pi-coding-agent/dist/bundle/cli.js']), 'pi');
  assert.equal(nativeAgent(['/usr/bin/bun', '/opt/@oh-my-pi/pi-coding-agent/dist/cli.js']), 'omp');
  assert.equal(nativeAgent(['/usr/bin/python3', '-m', 'hermes_cli.main']), 'hermes');
  assert.equal(nativeAgent(['/usr/bin/node', '/tmp/cursor-agent']), 'cursor');
  assert.equal(nativeAgent(['/usr/bin/node', '/opt/@earendil-works/pi-coding-agent/scripts/build.js']), null);
  assert.equal(nativeAgent(['/usr/bin/node', '/opt/@qwen-code/qwen-code/dist/index.js']), 'qwen');
});

test('ownership rejects nested first claims, nested clears, siblings and outside-terminal hooks', async () => {
  const entries = [
    [10, 1, ['bash']], [20, 10, ['node', '/state/src/launch.mjs']],
    [30, 20, ['node', '/tmp/pi']], [40, 30, ['sh']],
    [50, 40, ['codex']], [60, 50, ['node', '/state/src/capture.mjs']],
    [70, 10, ['claude']], [90, 1, ['pi']],
  ];
  const records = new Map(entries.map(([pid, ppid, argv]) => [pid, { pid, ppid, argv }]));
  const read = async pid => records.get(pid) || null;
  const terminal = owner => ({ pid: 10, state: 'live', labels: owner ? { 'herdr.state.owner': String(owner) } : {} });
  assert.equal((await ownershipDecision(terminal(), 'codex', 60, read)).allowed, false);
  assert.equal((await ownershipDecision(terminal(30), 'codex', 60, read)).allowed, false);
  assert.equal((await ownershipDecision(terminal(30), 'pi', 30, read)).allowed, true);
  assert.equal((await ownershipDecision(terminal(), 'pi', 30, read)).allowed, true);
  assert.equal((await ownershipDecision(terminal(99999), 'pi', 30, read)).allowed, true);
  assert.equal((await ownershipDecision(terminal(90), 'pi', 30, read)).allowed, true);
  assert.equal((await ownershipDecision(terminal(70), 'pi', 30, read)).allowed, false);
  assert.equal((await ownershipDecision(terminal(), 'pi', 90, read)).allowed, false);
  assert.equal((await ownershipDecision(terminal(), 'claude', 30, read)).allowed, false);
});

test('real inert native parent and nested child cannot overwrite or clear each other', t => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-owner-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const module = new URL('../src/ownership.mjs', import.meta.url).href;
  const source = [
    `import { writeOwnedLabels } from ${JSON.stringify(module)};`,
    "import fs from 'node:fs'; import {spawnSync} from 'node:child_process';",
    'const state = process.env.OWNER_STATE;',
    'const core = { async call(method, params) {',
    '  if(method === "terminal.get") return {pid:Number(process.env.ROOT_PID), state:"live", labels:JSON.parse(fs.readFileSync(state,"utf8"))};',
    '  const old = JSON.parse(fs.readFileSync(state,"utf8")); fs.writeFileSync(state,JSON.stringify({...old,...params.labels})); return {}; } };',
    'const label = (agent, value, clear=false) => writeOwnedLabels(agent,{"herdr.state.agent":clear?"":agent,"herdr.state.ref":clear?"":JSON.stringify({kind:"id",value})},{core});',
    'if(process.argv[2] === "nested") {',
    '  const wrote=await label("codex","child"); const cleared=await label("codex","child",true); console.log(JSON.stringify({wrote,cleared}));',
    '} else {',
    '  const first=await label("pi","parent");',
    '  const child=spawnSync(process.execPath,[process.env.CHILD_SCRIPT,"nested"],{env:process.env,encoding:"utf8"});',
    '  if(child.status !== 0) throw new Error(child.stderr);',
    '  const afterChild=JSON.parse(fs.readFileSync(state,"utf8"));',
    '  fs.writeFileSync(state,JSON.stringify({"pi.session_file":"/tmp/legacy.jsonl"}));',
    '  const legacy=spawnSync(process.execPath,[process.env.CHILD_SCRIPT,"nested"],{env:process.env,encoding:"utf8"});',
    '  if(legacy.status !== 0) throw new Error(legacy.stderr);',
    '  const afterLegacy=JSON.parse(fs.readFileSync(state,"utf8"));',
    '  fs.writeFileSync(state,JSON.stringify({"herdr.state.owner":"99999999"}));',
    '  const stale=await label("pi","replacement"); const switched=await label("pi","switched"); const cleared=await label("pi","switched",true);',
    '  console.log(JSON.stringify({pid:process.pid,first,child:JSON.parse(child.stdout),afterChild,legacy:JSON.parse(legacy.stdout),afterLegacy,stale,switched,cleared}));',
    '}',
  ].join('\n');
  for (const name of ['pi', 'codex']) writeFileSync(join(dir, name), source);
  const state = join(dir, 'labels.json');
  writeFileSync(state, '{}');
  const result = spawnSync(process.execPath, [join(dir, 'pi')], { encoding: 'utf8', env: {
    ...process.env, ROOT_PID: String(process.pid), HC_TERMINAL_ID: 't7b', OWNER_STATE: state,
    CHILD_SCRIPT: join(dir, 'codex'),
  } });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.first, true);
  assert.deepEqual(observed.child, { wrote: false, cleared: false });
  assert.equal(observed.afterChild['herdr.state.owner'], String(observed.pid));
  assert.equal(observed.afterChild['herdr.state.ref'], '{"kind":"id","value":"parent"}');
  assert.deepEqual(observed.legacy, { wrote: false, cleared: false });
  assert.deepEqual(observed.afterLegacy, { 'pi.session_file': '/tmp/legacy.jsonl' });
  assert.equal(observed.stale, true);
  assert.equal(observed.switched, true);
  assert.equal(observed.cleared, true);
  assert.deepEqual(JSON.parse(readFileSync(state, 'utf8')), {
    'herdr.state.agent': '', 'herdr.state.ref': '', 'herdr.state.ephemeral': '', 'herdr.state.owner': '',
  });
});
