import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sessionHooks, localOpenCodeClient } from '../integrations/session-plugin.mjs';

test('OpenCode server hooks cannot claim shared-server or full-TUI identity', () => {
  for (const args of [[], ['serve'], ['web'], ['attach', 'http://host'],
    ['run', '--attach=http://host'], ['run', '--attach', 'http://host'],
    ['serve', '--mini'], ['--', 'run']]) assert.equal(localOpenCodeClient(args), false);
  for (const args of [['run'], ['--mini'], ['--log-level', 'debug', 'run'],
    ['--print-logs', '--log-level=info', 'run']]) assert.equal(localOpenCodeClient(args), true);
});

test('native plugin adapters label only exact selected identities through fake hc', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-plugins-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'labels.jsonl');
  const state = join(dir, 'state.json');
  writeFileSync(state, '{}');
  writeFileSync(join(dir, 'hc'), [
    `#!${process.execPath}`,
    "const fs=require('node:fs');const rl=require('node:readline').createInterface({input:process.stdin});",
    'rl.on("line",line=>{const request=JSON.parse(line);let result={};',
    'if(request.method==="terminal.get")result={pid:Number(process.env.TEST_ROOT),state:"live",labels:JSON.parse(fs.readFileSync(process.env.TEST_STATE,"utf8"))};',
    'else {const labels=request.params.labels;const old=JSON.parse(fs.readFileSync(process.env.TEST_STATE,"utf8"));fs.writeFileSync(process.env.TEST_STATE,JSON.stringify(Object.fromEntries(Object.entries({...old,...labels}).filter(([,value])=>value!==""))));',
    'fs.appendFileSync(process.env.HC_LOG,JSON.stringify(["label",request.params.terminal,...Object.entries(labels).filter(([key])=>key!=="herdr.state.owner").map(([key,value])=>key+"="+value)])+"\\n");}',
    'console.log(JSON.stringify({id:request.id,result}));});',
  ].join('\n'), { mode: 0o755 });
  symlinkSync(process.execPath, join(dir, 'node'));
  const old = { PATH: process.env.PATH, HC_TERMINAL_ID: process.env.HC_TERMINAL_ID,
    HC_LOG: process.env.HC_LOG, HC_FAIL: process.env.HC_FAIL,
    HERDR_STATE_HC: process.env.HERDR_STATE_HC, TEST_STATE: process.env.TEST_STATE, TEST_ROOT: process.env.TEST_ROOT };
  Object.assign(process.env, { PATH: `${dir}:${old.PATH}`, HC_TERMINAL_ID: 't1z', HC_LOG: log,
    HERDR_STATE_HC: join(dir, 'hc'), TEST_STATE: state, TEST_ROOT: String(process.pid) });
  delete process.env.HC_FAIL;
  const labels = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const clearLog = () => writeFileSync(log, '');
  const expectRef = (agent, kind, value) => ['label', 't1z', `herdr.state.agent=${agent}`,
    `herdr.state.ref=${JSON.stringify({ kind, value })}`, 'herdr.state.ephemeral='];
  const cleared = ['label', 't1z', 'herdr.state.agent=', 'herdr.state.ref=', 'herdr.state.ephemeral='];
  try {
    for (const agent of ['opencode', 'kilo']) {
      clearLog();
      const hooks = sessionHooks(agent, async (_agent, values) => {
        if (process.env.HC_FAIL) throw new Error('owned transport failure');
        appendFileSync(log, JSON.stringify(['label', 't1z',
          ...Object.entries(values).map(([key, value]) => `${key}=${value}`)]) + '\n');
        return true;
      });
      const event = (type, properties) => hooks.event({ event: { type, properties } });
      await event('session.created', { info: { id: 'background' } });
      await event('session.updated', { info: { id: 'unselected' } });
      assert.deepEqual(labels(), []);
      await event('session.created', { info: { id: 'child', parentID: 'root' } });
      await hooks['chat.message']({ sessionID: 'child' });
      assert.deepEqual(labels(), []);
      await hooks['chat.message']({ sessionID: 'root' });
      await event('session.updated', { info: { id: 'background' } });
      assert.deepEqual(labels(), [expectRef(agent, 'id', 'root')]);
      await event('session.updated', { info: { id: 'root' } });
      await hooks['chat.message']({ sessionID: 'selected-B' });
      await event('session.deleted', { info: { id: 'root' } });
      assert.deepEqual(labels().at(-1), expectRef(agent, 'id', 'selected-B'));
      await event('session.deleted', { info: { id: 'selected-B' } });
      assert.deepEqual(labels().at(-1), cleared);
      await assert.rejects(hooks['chat.message']({ sessionID: '-invalid' }), /native session/);
      process.env.HC_FAIL = '1';
      await assert.rejects(hooks['chat.message']({ sessionID: 'failure' }));
      delete process.env.HC_FAIL;
      await hooks['chat.message']({ sessionID: 'recovered' });
      assert.deepEqual(labels().at(-1), expectRef(agent, 'id', 'recovered'));
    }

    clearLog();
    const ompScript = join(dir, 'omp');
    writeFileSync(ompScript, [
      `import omp from ${JSON.stringify(new URL('../integrations/omp.ts', import.meta.url).href)};`,
      "import assert from 'node:assert/strict';",
      'const handlers=new Map(); const api={on:(event,handler)=>handlers.set(event,handler)};',
      'process.env.OMPCODE="1";await omp(api);assert.equal(handlers.size,0);delete process.env.OMPCODE;await omp(api);',
      'const ctx=file=>({sessionManager:{getSessionFile:()=>file}});',
      'await handlers.get("session_start")({},ctx("/tmp/omp-A.jsonl"));',
      'await handlers.get("session_switch")({},ctx("/tmp/omp-B.jsonl"));',
      'await handlers.get("agent_start")({},ctx("/tmp/omp-B.jsonl"));',
      'await handlers.get("agent_start")({},ctx("/tmp/omp-C.jsonl"));',
      'await handlers.get("session_shutdown")({},ctx());',
      'await handlers.get("session_start")({},ctx());',
      'await assert.rejects(handlers.get("session_start")({},ctx("relative.jsonl")),/invalid OMP/);',
    ].join('\n'));
    const ompRun = spawnSync(process.execPath, [ompScript], { env: process.env, encoding: 'utf8' });
    assert.equal(ompRun.status, 0, ompRun.stderr);
    assert.deepEqual(labels(), [expectRef('omp', 'path', '/tmp/omp-A.jsonl'),
      expectRef('omp', 'path', '/tmp/omp-B.jsonl'), expectRef('omp', 'path', '/tmp/omp-C.jsonl'), cleared,
      ['label', 't1z', 'herdr.state.agent=', 'herdr.state.ref=', 'herdr.state.ephemeral=1']]);
    assert.equal(JSON.parse(readFileSync(state, 'utf8'))['herdr.state.ephemeral'], '1');

    clearLog();
    writeFileSync(state, JSON.stringify({ 'herdr.state.owner': '99999999', 'herdr.state.agent': 'pi',
      'herdr.state.ref': '{"kind":"id","value":"old"}', 'pi.session_file': '/tmp/legacy.jsonl' }));
    const piScript = join(dir, 'pi');
    writeFileSync(piScript, [
      `import extension from ${JSON.stringify(new URL('../integrations/pi.ts', import.meta.url).href)};`,
      "import fs from 'node:fs';",
      'async function runtime(){const events=new Map();await extension({on:(event,callback)=>events.set(event,callback)});return events;}',
      'const read=()=>JSON.parse(fs.readFileSync(process.env.TEST_STATE,"utf8"));',
      'const ctx=file=>({sessionManager:{getSessionFile:()=>file}});',
      'const first=await runtime();await first.get("session_start")({},ctx());const ephemeral=read();',
      'await first.get("session_shutdown")();const ended=read();',
      'await first.get("session_start")({},ctx("/tmp/pi-A.jsonl"));',
      'const second=await runtime();await second.get("session_start")({},ctx("/tmp/pi-B.jsonl"));',
      'await first.get("session_shutdown")();const newer=read();',
      'await second.get("session_shutdown")();console.log(JSON.stringify({pid:process.pid,ephemeral,ended,newer,final:read()}));',
    ].join('\n'));
    const piRun = spawnSync(process.execPath, [piScript], { env: process.env, encoding: 'utf8' });
    assert.equal(piRun.status, 0, piRun.stderr);
    const piState = JSON.parse(piRun.stdout);
    assert.equal(piState.ephemeral['herdr.state.ephemeral'], '1');
    assert.equal(piState.ephemeral['herdr.state.owner'], String(piState.pid));
    assert.equal(piState.ephemeral['herdr.state.ref'] ?? '', '');
    assert.equal(piState.ephemeral['pi.session_file'], '/tmp/legacy.jsonl');
    assert.equal(piState.ended['herdr.state.ephemeral'] ?? '', '');
    assert.equal(piState.newer['herdr.state.ref'], '{"kind":"path","value":"/tmp/pi-B.jsonl"}');
    assert.equal(piState.final['herdr.state.owner'] ?? '', '');

    clearLog();
    const plugin = fileURLToPath(new URL('../integrations/hermes/__init__.py', import.meta.url));
    const hermesScript = join(dir, 'hermes');
    writeFileSync(hermesScript, [
      'import importlib.util, sys',
      'spec = importlib.util.spec_from_file_location("herdr_test_plugin", sys.argv[1])',
      'plugin = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(plugin)',
      'class Context:',
      '    def __init__(self): self.hooks = {}',
      '    def register_hook(self, name, callback): self.hooks[name] = callback',
      'ctx = Context()',
      'plugin.register(ctx)',
      'ctx.hooks["on_session_start"](platform="cli", session_id="hermes-start")',
      'ctx.hooks["on_session_reset"](platform="tui", session_id="hermes-reset")',
      'ctx.hooks["pre_llm_call"](platform="cli", session_id="hermes-resume")',
      'ctx.hooks["pre_llm_call"](platform="tui", session_id="must-not-claim")',
      'ctx.hooks["on_session_start"](platform="telegram", session_id="background")',
      'ctx.hooks["on_session_start"](platform="cli", session_id=None)',
    ].join('\n'));
    const python = spawnSync('python3', [hermesScript, plugin],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' });
    assert.equal(python.status, 0, python.stderr);
    assert.deepEqual(labels(), ['hermes-start', 'hermes-reset', 'hermes-resume']
      .map(id => expectRef('hermes', 'id', id)));
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
