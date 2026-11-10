// Real Core and inert PTYs. No coding agent, model, account or live session.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { watch } from 'node:fs';
import { dirname, basename } from 'node:path';
import { Core } from '../src/core.mjs';
import { workspaceDatabasePath, readControl } from '../src/storage.mjs';
import { openWorkspaceDatabase } from '../src/database.mjs';
import { install, installMod } from './install.mjs';
import { emptyActivity, observeCoverage, recordEngagement, activitySummary } from '../src/activity.mjs';
import { nextGeneric, nextJob } from '../src/policy.mjs';
import { validatePolicy } from '../src/config.mjs';
import { DatabaseSync } from 'node:sqlite';

const execute = promisify(execFile);
const root = await mkdtemp('/var/tmp/herdr-proactive-');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HC_')));
Object.assign(env, { HC_SESSION: 'proactive-smoke', HC_SOCKET: join(root, 'core.sock'),
  XDG_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(root, 'config'), XDG_RUNTIME_DIR: root,
  HERDR_APP_HOME: join(root, 'app'), SHELL: '/bin/sh', PATH: join(root, 'bin') + ':' + process.env.PATH });
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const run = (action, data) => execute(process.execPath, [cli, action, ...data === undefined ? [] : [JSON.stringify(data)]],
  { env, timeout: 30000 }).then(reply => JSON.parse(reply.stdout));
let core, subscription, service;

// Wait on Core events, with one initial read. A timeout fails the smoke, never polls.
function waitFor(read, predicate, filter, description = String(predicate), path = null) {
  return new Promise((resolve, reject) => {
    let reading = false, dirty = false, done = false, last;
    const timer = setTimeout(() => finish(new Error('Timed out: ' + description + '\nLast: ' + JSON.stringify(last))), 15000);
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription.off('notification', event);
      watcher?.close();
      if (error) reject(error); else resolve(value);
    };
    const check = async () => {
      dirty = true;
      if (reading) return;
      reading = true;
      try {
        while (dirty && !done) {
          dirty = false;
          const value = await read();
          last = value;
          if (predicate(value)) finish(null, value);
        }
      } catch (error) { finish(error); }
      reading = false;
    };
    const event = message => { if (message.method === 'event' && filter(message.params)) void check(); };
    const watcher = path ? watch(dirname(path), (_kind, name) => { if (!name || name.toString() === 'state.changed') void check(); }) : null;
    subscription.on('notification', event);
    void check();
  });
}
function databaseSnapshot(path, section) {
  const db = openWorkspaceDatabase(path, { readOnly: true, create: false });
  try { return db ? section === 'activity' ? db.readActivity() : db.readRuntime() : null; }
  finally { db?.close(); }
}
const waitState = (path, check, section = 'runtime') => waitFor(() => databaseSnapshot(path, section), check, () => false, path + ': ' + check, path);
const waitAgent = (address, check) => waitFor(() => core.call('terminal.get', { terminal: address }), check, e => e.terminal === address);

async function startService() {
  const child = spawn(process.execPath, [cli, 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  service = child;
  let output = '', errors = '';
  child.stderr.on('data', bytes => { errors += bytes; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Service startup timeout: ' + errors + output)), 15000);
    const ended = code => { clearTimeout(timer); reject(new Error('Service exited: ' + code + ' ' + output + errors)); };
    child.once('exit', ended);
    child.stdout.on('data', bytes => {
      output += bytes;
      if (output.includes('"running":true')) { clearTimeout(timer); child.off('exit', ended); resolve(); }
    });
  });
  return child;
}

async function stopService(signal = 'SIGTERM') {
  if (!service || service.exitCode !== null || service.signalCode) return;
  const ended = once(service, 'exit');
  service.kill(signal);
  await ended;
}

try {
  // Consequential pure boundaries: rollover, bounded retention and unknown coverage.
  const activity = emptyActivity();
  const historyPath = join(root, 'history.sqlite');
  const history = openWorkspaceDatabase(historyPath);
  try {
    for (let month = 0; month < 16; month++) {
      const at = Date.UTC(2025, month, 10, 9);
      observeCoverage(activity, at, at + 3600000);
      recordEngagement(activity, at + 1000);
      history.writeActivity(activity);
    }
  } finally { history.close(); }
  const stored = new DatabaseSync(historyPath, { readOnly: true });
  try {
    assert.equal(stored.prepare("SELECT count(*) n FROM activity_bucket WHERE resolution='month'").get().n, 13);
    assert.ok(stored.prepare("SELECT count(*) n FROM activity_bucket WHERE resolution='day'").get().n <= 35);
    assert.equal(stored.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  } finally { stored.close(); }
  assert.equal(activity.months.length, 13);
  assert.ok(activity.days.length <= 35);
  const summary = activitySummary(activity, Date.UTC(2026, 3, 11));
  assert.equal(summary.past.months, 12);
  assert.equal(summary.monthly.engagements, 1);
  assert.equal(activitySummary(emptyActivity(), Date.now()).weekly.rate, null);
  const at = Date.UTC(2026, 10, 6, 12);
  assert.equal(nextJob({ schedule: { kind: 'once', at } }, at), null);
  const policy = { mode: 'fixed', minMinutes: 15, quietStart: 22, quietEnd: 8 };
  const deadline = nextGeneric(policy, { enabledAt: at, pendingUnseen: true }, emptyActivity(), at);
  assert.equal(deadline.at, null);
  assert.ok(nextGeneric(policy, { enabledAt: at }, emptyActivity(), at).at > at);
  const previous = { id: 'p', space: 'workspace', terminal: 't1', enabled: true,
    enabledAt: at - 10 * 86400000, binding: { created: at - 10 * 86400000, pid: 1 }, jobs: [] };
  const added = validatePolicy({ ...previous, name: 'Jobs only', mode: 'off', prompt: '', allowTerminalInput: true,
    jobs: [{ id: 'daily', name: 'Daily', prompt: 'Explicit work', schedule: { kind: 'daily', time: '09:00' } }] }, previous, null, at);
  assert.equal(added.prompt, '');
  assert.equal(added.jobs[0].createdAt, at);
  assert.ok(nextJob(added.jobs[0], added.jobs[0].createdAt - 1) > at, 'new daily jobs do not inherit old policy backlog');

  await mkdir(join(root, 'config/herdr-core'), { recursive: true });
  await writeFile(join(root, 'config/herdr-core/config.toml'), 'notes = false\nshell = ["/bin/sh"]\n');
  await install(join(root, 'bin'));
  await installMod(env.HERDR_APP_HOME);
  await assert.rejects(installMod(join(root, 'unowned')).then(async () => {
    await writeFile(join(root, 'unowned/mods/proactive/.herdr-proactive'), 'not ours');
    await installMod(join(root, 'unowned'));
  }), /marker/);
  await execute('hc', ['server', 'start'], { env, timeout: 15000 });
  core = new Core(env);
  const info = await core.call('server.status');
  const databasePath = workspaceDatabasePath(info.core.id, root, env);
  subscription = new Core(env);
  await subscription.call('events.subscribe');
  const fixture = join(root, 'fixture.mjs');
  const log = join(root, 'prompts');
  await writeFile(fixture, [
    'import { appendFileSync } from "node:fs";',
    'process.stdin.setRawMode(true); process.stdin.resume();',
    'const status=s=>process.stdout.write("\\x1b]7501;state="+s+":app=fixture\\x1b\\\\");',
    'process.stdout.write("\\x1b[?2004h"); status("idle"); let input="";',
    'process.stdin.on("data",chunk=>{ for(const c of chunk.toString()){',
    'if(c==="\\x02"){status("working");continue;} if(c==="\\x09"){status("idle");continue;}',
    'if(c!=="\\r"){input+=c;continue;}',
    'appendFileSync(' + JSON.stringify(log) + ',JSON.stringify(input)+"\\n"); input="";status("working");setTimeout(()=>status("idle"),200);',
    '}});',
  ].join('\n'));
  const made = await core.call('terminal.run', { argv: [process.execPath, fixture], cwd: root, no_parent: true,
    labels: { 'herdr.space': 'workspace' } });
  const address = made.address;
  await waitAgent(address, t => t.status?.state === 'idle');
  const second = await core.call('terminal.run', { argv: [process.execPath, fixture], cwd: root, no_parent: true,
    labels: { 'herdr.space': 'workspace', 'herdr.seen': '0' } });
  await waitAgent(second.address, t => t.status?.state === 'idle');
  const otherRoot = join(root, 'other-workspace');
  await mkdir(otherRoot);
  const other = await core.call('terminal.run', { argv: [process.execPath, fixture], cwd: otherRoot, no_parent: true,
    labels: { 'herdr.space': 'other' } });
  await waitAgent(other.address, t => t.status?.state === 'idle');
  const otherConfigured = await run('configure', { name: 'Independent workspace', scope: 'workspace', space: 'other', terminal: other.address,
    enabled: true, allowTerminalInput: true, mode: 'off', prompt: 'Another independent SOP', jobs: [] });
  const otherDatabasePath = workspaceDatabasePath(info.core.id, otherRoot, env);
  const instructions = '\n    A harmless fixture prompt  \n\n';
  const configured = await run('configure', { name: 'Smoke', scope: 'workspace', space: 'workspace', terminal: address,
    enabled: true, allowTerminalInput: true, mode: 'off', prompt: instructions, jobs: [] });
  const id = configured.configured;
  assert.ok(configured.path.endsWith('/PROACTIVE.md'));
  assert.ok((await readFile(configured.path, 'utf8')).endsWith(instructions));
  await startService();
  const status = await run('status');
  assert.equal(status.service.running, true);
  assert.equal(status.activity.workspace.weekly.engagements, 0, 'snapshot is not fresh engagement');
  // Busy work is deferred until idle, then the event releases exactly one manual request.
  await core.call('terminal.keys', { terminal: address, keys: ['ctrl+b'] });
  await waitAgent(address, t => t.status?.state === 'working');
  await run('run', { id });
  await waitState(databasePath, value => value?.policies[id]?.reason?.includes('working'));
  await core.call('terminal.keys', { terminal: address, keys: ['tab'] });
  await waitState(databasePath, value => value?.policies[id]?.receipts.some(r => r.outcome === 'started'));
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1);
  const completed = await waitAgent(address, t => t.status?.state === 'idle' && t.turn >= 2);
  await core.call('terminal.label', { terminal: address, labels: { 'herdr.seen': String(completed.turn) } });
  await waitState(databasePath, value => value?.months[0]?.engagements === 1, 'activity');
  await waitState(databasePath, value => value?.policies[id]?.pendingUnseen === false);
  await core.call('terminal.label', { terminal: second.address, labels: { 'herdr.seen': '1' } });
  await waitState(databasePath, value => value?.policies[id]?.lastEngagementAt > 0);
  // Ordinary file authoring reaches the scheduler through filesystem events.
  const pulseHome = join(root, 'pulses/agent-authored');
  await mkdir(pulseHome, { recursive: true });
  const pulse = ['---', 'title: Agent-authored automation', 'policy: ' + basename(dirname(configured.path)),
    'enabled: true', 'schedule: every 1h', 'timezone: UTC', '---', '# Plain Markdown',
    'Inspect only the fixture.', '', '```json', '{"sample": "not an escaped instruction string"}', '```', ''].join('\n');
  await writeFile(join(pulseHome, 'PULSE.md'), pulse);
  await writeFile(join(pulseHome, 'journal.md'), 'Keep this artifact.');
  await waitState(databasePath, value => Boolean(value?.policies[id]?.jobDefinitions?.['agent-authored']));
  const reloaded = await run('status');
  const loadedPolicy = reloaded.policies.find(policy => policy.id === id);
  assert.equal(loadedPolicy.jobs[0].prompt, pulse.slice(pulse.indexOf('# Plain Markdown')));
  assert.equal(loadedPolicy.jobs[0].schedule.anchor, undefined);
  await run('configure', { ...loadedPolicy, name: 'Renamed Smoke' });
  assert.equal(await readFile(join(pulseHome, 'PULSE.md'), 'utf8'), pulse, 'unrelated policy edits never rewrite pulse bodies or inferred anchors');
  assert.ok((await readFile(configured.path, 'utf8')).endsWith(instructions));
  // Crash with persisted send intent. Recovery holds the attempt, acknowledgement
  // consumes it instead of repeating the still-present manual request.
  await run('run', { id });
  await waitState(databasePath, value => value?.policies[id]?.inflight?.kind === 'manual');
  await stopService('SIGKILL');
  await startService();
  await waitState(databasePath, value => value?.policies[id]?.awaitingAck === true);
  await run('acknowledge', { id });
  const acknowledged = await waitState(databasePath, value => value?.policies[id]?.awaitingAck === false);
  const control = await readControl(info.core.id, root, env);
  assert.equal(acknowledged.policies[id].manualRequest, control.value.policies[id].manualRequest);
  assert.equal(acknowledged.policies[id].inflight, null);
  assert.equal(acknowledged.policies[id].receipts.length, 2);
  assert.ok(!(await readFile(databasePath)).includes(Buffer.from('A harmless fixture prompt')));
  // A malformed automation is local: another workspace remains runnable.
  await writeFile(join(pulseHome, 'PULSE.md'), pulse.replace('every 1h', 'not a schedule'));
  await waitState(databasePath, value => !value?.policies[id]?.jobDefinitions?.['agent-authored']);
  assert.ok((await run('status')).errors.some(error => error.path === join(pulseHome, 'PULSE.md')));
  await run('run', { id: otherConfigured.configured });
  await waitState(otherDatabasePath, value => value?.policies[otherConfigured.configured]?.receipts.some(receipt => receipt.outcome === 'started'));
  assert.equal((await readFile(otherConfigured.path, 'utf8')).includes('Another independent SOP'), true);
  await writeFile(join(pulseHome, 'PULSE.md'), pulse);
  await waitState(databasePath, value => Boolean(value?.policies[id]?.jobDefinitions?.['agent-authored']));
  await run('remove', { id });
  await assert.rejects(readFile(join(pulseHome, 'PULSE.md')), { code: 'ENOENT' });
  assert.equal(await readFile(join(pulseHome, 'journal.md'), 'utf8'), 'Keep this artifact.');
  await stopService();
  console.log('PASS: Core/file events, Markdown authoring, bounded history, busy deferral, engagement, crash recovery, artifact-safe removal');
} finally {
  await stopService();
  subscription?.close();
  core?.close();
  await execute('hc', ['server', 'stop'], { env, timeout: 10000 }).catch(error => console.error('Scratch shutdown: ' + error.message));
  await rm(root, { recursive: true, force: true });
}
