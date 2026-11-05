import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refFromReport, labelArgs } from '../src/capture.mjs';
import { hookSnippet } from '../integrations/hooks.mjs';

test('capture recognises explicit native fields and prefers Pi/OMP files', () => {
  for (const key of ['session_id', 'sessionId', 'sessionID', 'conversation_id',
    'conversationId', 'conversationID', 'thread_id', 'threadId', 'thread-id', 'agent_session_id']) {
    assert.deepEqual(refFromReport('codex', { [key]: 'native' }), { kind: 'id', value: 'native' });
  }
  for (const agent of ['pi', 'omp']) {
    for (const key of ['session_path', 'sessionPath', 'session_file', 'sessionFile', 'agent_session_path']) {
      assert.deepEqual(refFromReport(agent, { [key]: '/tmp/exact.jsonl', session_id: 'id' }),
        { kind: 'path', value: '/tmp/exact.jsonl' });
    }
    assert.deepEqual(refFromReport(agent, { session_path: 'relative', session_id: 'id' }),
      { kind: 'id', value: 'id' });
  }
  assert.deepEqual(refFromReport('letta', { conversation_id: 'default', agent_id: 'agent-1' }),
    { kind: 'id', value: 'default:agent-1' });
  assert.equal(refFromReport('letta', { conversation_id: 'default' }), null);
});

test('capture never infers identity from cwd, transcript, or malformed payloads', () => {
  for (const report of [null, [], 'id', {}, { cwd: '/tmp' },
    { transcript_path: '/tmp/transcript.jsonl' }, { session_id: '-bad' },
    { session_id: 1 }, { session_id: 'bad\n' }]) {
    assert.equal(refFromReport('claude', report), null);
  }
  assert.throws(() => labelArgs('server/t1', 'pi', {}, true), /local terminal/);
  assert.throws(() => labelArgs('-t1', 'pi', {}, true), /local terminal/);
  assert.deepEqual(labelArgs('t7b', 'pi', {}, true),
    ['label', 't7b', 'herdr.state.agent=', 'herdr.state.ref=', 'herdr.state.ephemeral=']);
  assert.throws(() => labelArgs('t1', 'custom', {}, true), /unsupported/);
  assert.throws(() => labelArgs('t1', 'pi', {}), /native session/);
});

test('CLI labels exact JSON, clears both keys, and does not touch hc on invalid input', t => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-capture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, 'argv.json');
  const script = fileURLToPath(new URL('../src/capture.mjs', import.meta.url));
  const state = join(dir, 'labels.json');
  writeFileSync(state, '{}');
  writeFileSync(join(dir, 'hc'), [
    `#!${process.execPath}`,
    "const fs=require('node:fs'); const rl=require('node:readline').createInterface({input:process.stdin});",
    'rl.on("line", line => {const request=JSON.parse(line); let result={};',
    'if(request.method==="terminal.get") result={pid:Number(process.env.TEST_ROOT),state:"live",labels:JSON.parse(fs.readFileSync(process.env.TEST_STATE,"utf8"))};',
    'else {fs.writeFileSync(process.env.TEST_STATE,JSON.stringify(request.params.labels)); fs.writeFileSync(process.env.ARGV_OUT,JSON.stringify(request.params));}',
    'console.log(JSON.stringify({id:request.id,result}));});',
  ].join('\n'), { mode: 0o755 });
  const actor = [
    "const {spawnSync}=require('node:child_process');",
    'for (const action of JSON.parse(process.argv[2])) {',
    'const result=spawnSync(action.command?"/bin/sh":process.execPath,action.command?["-c",action.command]:[process.env.TEST_CAPTURE,...action.args],',
    '{env:process.env,input:action.input||"",encoding:"utf8"});',
    'if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1);}',
    'process.stdout.write(result.stdout);}',
  ].join('\n');
  for (const agent of ['pi', 'claude', 'codex', 'droid', 'grok', 'qodercli', 'qwen',
    'letta', 'devin', 'copilot', 'cursor-agent', 'mastracode', 'agy', 'kimi']) writeFileSync(join(dir, agent), actor);
  const env = { ...process.env, PATH: dir, HC_TERMINAL_ID: 't7', ARGV_OUT: output,
    TEST_STATE: state, TEST_ROOT: String(process.pid), TEST_CAPTURE: script,
    HERDR_STATE_HC: join(dir, 'hc'), CODEX_THREAD_ID: '' };
  const runActions = (agent, actions, overrides = {}) => spawnSync(process.execPath,
    [join(dir, agent === 'cursor' ? 'cursor-agent' : agent), JSON.stringify(actions)],
    { env: { ...env, ...overrides }, encoding: 'utf8' });
  const run = (args, input = '', overrides = {}) => runActions(args[0], [{ args, input }], overrides);
  const observed = () => {
    const value = JSON.parse(readFileSync(output, 'utf8'));
    const owner = value.labels['herdr.state.owner'];
    assert.ok(owner === '' || /^\d+$/.test(owner));
    delete value.labels['herdr.state.owner'];
    return value;
  };
  const value = '/tmp/space and \'quote;$(false).jsonl';
  assert.equal(run(['pi'], JSON.stringify({ session_path: value })).status, 0);
  assert.deepEqual(observed(), { terminal: 't7', labels: {
    'herdr.state.agent': 'pi', 'herdr.state.ref': JSON.stringify({ kind: 'path', value }), 'herdr.state.ephemeral': '',
  } });
  assert.equal(runActions('pi', [{ args: ['pi'], input: '{"session_id":"native"}' },
    { args: ['pi', '--clear'] }]).status, 0);
  assert.deepEqual(observed(), { terminal: 't7', labels: {
    'herdr.state.agent': '', 'herdr.state.ref': '', 'herdr.state.ephemeral': '',
  } });
  // Generated POSIX hook commands must execute the same stdin capture, with no stdout.
  for (const agent of ['claude', 'codex', 'droid', 'grok', 'qodercli', 'qwen',
    'letta', 'devin', 'copilot', 'cursor', 'mastracode', 'agy', 'kimi']) {
    const snippet = hookSnippet(agent);
    let command;
    if (typeof snippet === 'string') command = JSON.parse(snippet.match(/^command = (.+)$/m)[1]);
    else if (agent === 'copilot') command = snippet.hooks.SessionStart[0].bash;
    else if (agent === 'cursor') command = snippet.hooks.sessionStart[0].command;
    else if (agent === 'mastracode') command = snippet.SessionStart[0].command;
    else if (agent === 'agy') command = snippet['herdr-state'].PreInvocation[0].command;
    else command = snippet.hooks.SessionStart[0].hooks[0].command;
    const hook = runActions(agent, [{ command, input: '{"session_id":"native"}' }]);
    assert.equal(hook.status, 0, `${agent}: ${hook.stderr}`);
    assert.equal(hook.stdout, '', agent);
    assert.deepEqual(observed(), { terminal: 't7', labels: {
      'herdr.state.agent': agent, 'herdr.state.ref': '{"kind":"id","value":"native"}', 'herdr.state.ephemeral': '',
    } });
  }
  rmSync(output);
  assert.equal(run(['pi'], 'broken').status, 1);
  assert.equal(run(['pi'], '{}').status, 1);
  assert.equal(run(['pi'], '', { HC_TERMINAL_ID: '' }).status, 0);
  assert.equal(run(['codex'], '{"session_id":"child"}', { CODEX_THREAD_ID: 'parent' }).status, 0);
  assert.throws(() => readFileSync(output), { code: 'ENOENT' });
  const failure = run(['pi'], '{"session_id":"exact"}', { HERDR_STATE_HC: '/nonexistent/hc' });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /ENOENT/);
});
