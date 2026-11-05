// Loads the real Pi extension through its installed symlink. No prompts or model calls.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Core } from '../src/rpc.mjs';
import { sessionOf } from '../src/snapshot.mjs';

const exec = promisify(execFile);
const root = await mkdtemp('/var/tmp/hp-');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HC_')) delete env[key];
Object.assign(env, { HC_SESSION: 's', HC_SOCKET: `${root}/c.sock`, XDG_CONFIG_HOME: `${root}/config`,
  XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: root, PI_CODING_AGENT_DIR: `${root}/pi` });
let core;
try {
  await mkdir(`${root}/pi/extensions`, { recursive: true });
  const extension = `${root}/pi/extensions/herdr-state.ts`;
  await symlink(fileURLToPath(new URL('../integrations/pi.ts', import.meta.url)), extension);
  const session = `${root}/exact.jsonl`;
  await writeFile(session, JSON.stringify({ type: 'session', version: 3, id: '7b0d4e36-62b1-4ec6-90df-d6ac8abc7230',
    timestamp: new Date().toISOString(), cwd: root }) + '\n');
  await exec('hc', ['server', 'start'], { env });
  core = new Core(env);
  const terminal = await core.call('terminal.run', { argv: ['pi', '--mode', 'rpc', '-nc', '-ns', '-np', '-ne',
    '-e', extension, '--session', session], cwd: root, env: { PI_CODING_AGENT_DIR: `${root}/pi` }, no_parent: true });
  async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
      const view = await core.call('terminal.get', { terminal: terminal.address });
      if (predicate(view)) return view;
      if (view.state !== 'live') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const output = await core.call('terminal.read', { terminal: terminal.address, lines: 100 });
    throw new Error(`Pi capture did not settle: ${output.text}`);
  }
  const captured = await waitFor(t => t.labels['herdr.state.ref'] !== undefined);
  assert.deepEqual(JSON.parse(captured.labels['herdr.state.ref']), { kind: 'path', value: session });
  assert.ok(captured.labels['herdr.state.owner']);
  await core.call('terminal.send', { terminal: terminal.address, text: '{"id":"switch","type":"new_session"}' });
  await waitFor(t => t.labels['herdr.state.ref'] && JSON.parse(t.labels['herdr.state.ref']).value !== session);
  const ephemeral = await core.call('terminal.run', { argv: ['pi', '--mode', 'rpc', '-nc', '-ns', '-np', '-ne',
    '-e', extension, '--no-session'], cwd: root, env: { PI_CODING_AGENT_DIR: `${root}/pi` }, no_parent: true,
    labels: { 'pi.session_file': session, 'herdr.state.agent': 'pi', 'herdr.state.owner': '999999999',
      'herdr.state.ref': JSON.stringify({ kind: 'path', value: session }) } });
  let ephemeralView;
  for (let i = 0; i < 100; i++) {
    ephemeralView = await core.call('terminal.get', { terminal: ephemeral.address });
    if (ephemeralView.labels['herdr.state.ephemeral'] === '1') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ephemeralView.labels['herdr.state.ephemeral'], '1');
  assert.equal(ephemeralView.labels['herdr.state.ref'], undefined);
  assert.equal(sessionOf(ephemeralView), null, 'ephemeral Pi never falls back to a stale native label');
  console.log('PASS: real Pi symlink loader, exact native path, owner claim, session switch; no model calls');
} finally {
  core?.close();
  await exec('hc', ['server', 'stop'], { env }).catch(error => console.error(error.message));
  await rm(root, { recursive: true, force: true });
}
