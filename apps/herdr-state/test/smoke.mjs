// Real Core, real PTYs, no model calls. The only "agent" is our inert argv recorder.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Core } from '../src/rpc.mjs';
import { idleShell } from '../src/process.mjs';

const exec = promisify(execFile);
const root = await mkdtemp('/var/tmp/hs-');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HC_')) delete env[key];
Object.assign(env, { HC_SESSION: 's', HC_SOCKET: `${root}/c.sock`, XDG_CONFIG_HOME: `${root}/config`,
  XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: root, SHELL: '/bin/sh' });
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const run = action => exec(process.execPath, [cli, action], { env, timeout: 25000 }).then(r => JSON.parse(r.stdout));
async function until(read, predicate) {
  for (let i = 0; i < 80; i++) {
    const value = await read();
    if (await predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('isolated smoke did not settle');
}
let core;
try {
  await mkdir(`${root}/config/herdr-core`, { recursive: true });
  await writeFile(`${root}/config/herdr-core/config.toml`, 'shell = ["/bin/sh"]\nnotes = false\n');
  await mkdir(`${root}/bin`);
  await writeFile(`${root}/bin/pi`, `#!${process.execPath}\nimport('node:fs').then(fs => fs.appendFileSync(${JSON.stringify(root + '/launches')}, JSON.stringify(process.argv.slice(2))+'\\n')); setInterval(()=>{},1000);\n`, { mode: 0o700 });
  const session = `${root}/exact.jsonl`;
  await writeFile(session, '{}\n');
  await exec('hc', ['server', 'start'], { env });
  core = new Core(env);
  const made = await core.call('terminal.run', { argv: ['sleep', '600'], cwd: root, keep: true,
    no_parent: true, env: { PATH: `${root}/bin:${process.env.PATH}` }, labels: {
      'herdr.space': 's1', 'herdr.tab': 'tab1', 'herdr.state.agent': 'pi',
      'herdr.state.ref': JSON.stringify({ kind: 'path', value: session }),
    } });
  const address = made.address;
  await core.call('doc.set', { name: 'herdr-app', version: 0, value: { spaces: [{ id: 's1', folder: root,
    tabs: [{ id: 'tab1', root: { id: 'p1', type: 'block', content: { terminal: address } } }] }] } });
  assert.equal((await run('save')).sessions, 1);
  core.close();
  await exec('hc', ['server', 'stop'], { env });
  await exec('hc', ['server', 'start'], { env });
  core = new Core(env);
  const recovered = await until(() => core.call('terminal.get', { terminal: address }), idleShell);
  const environment = await readFile(`/proc/${recovered.pid}/environ`, 'utf8');
  assert.ok(environment.includes(`PATH=${root}/bin:`), 'never invoke a real Pi');
  await core.call('terminal.keys', { terminal: address, keys: ['e', 'c', 'h', 'o', 'space', 'n', 'e', 'v', 'e', 'r'] });
  const restored = await run('restore');
  assert.equal(restored.launched, 1, JSON.stringify(restored));
  assert.deepEqual(restored.warnings, []);
  assert.equal(restored.parked, 1);
  await until(async () => readFile(`${root}/launches`, 'utf8').catch(() => ''), text => text.includes('--session'));
  const again = await run('restore');
  assert.equal(again.launched, 0);
  assert.equal(again.skipped, 1, JSON.stringify(again));
  assert.equal((await readFile(`${root}/launches`, 'utf8')).trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse((await readFile(`${root}/launches`, 'utf8')).trim()), ['--session', session]);
  const document = await core.call('doc.get', { name: 'herdr-app' });
  const replacement = document.value.spaces[0].tabs[0].root.content.terminal;
  assert.notEqual(replacement, address);
  const old = await core.call('terminal.get', { terminal: address });
  assert.equal(old.state, 'live');
  assert.equal(old.keep, false);
  assert.equal(old.labels['herdr.space'], undefined);
  assert.ok((await core.call('terminal.read', { terminal: address, lines: 0 })).text.includes('echo never'));
  console.log('PASS: save, Core stop/start, exact resume, preserved pane, old shell parked, duplicate-safe Restore; no model calls');
} finally {
  core?.close();
  await exec('hc', ['server', 'stop'], { env }).catch(error => console.error(`Scratch shutdown: ${error.message}`));
  await rm(root, { recursive: true, force: true });
}
