#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { Core } from './rpc.mjs';
import { SNAPSHOT, makeSnapshot, validateSnapshot } from './snapshot.mjs';
import { restore } from './restore.mjs';
import { idleShell, agentEnvironment } from './process.mjs';

const core = new Core();
const action = process.argv[2];
const owner = randomUUID();
let locked = false;

async function leaseCheck() {
  const lock = await core.call('doc.get', { name: 'herdr-state-lock' });
  if (lock.value?.owner !== owner || lock.value.until < Date.now()) throw new Error('State operation lease expired; inspect terminals before retrying');
  await core.call('doc.set', { name: 'herdr-state-lock', version: lock.version, value: { owner, until: Date.now() + 60000 } });
}

try {
  if (!['save', 'restore', 'status'].includes(action)) throw new Error('Usage: herdr-state save|restore|status');
  const info = await core.call('server.status');
  if (action !== 'status') {
    const lock = await core.call('doc.get', { name: 'herdr-state-lock' });
    if (lock.value?.until > Date.now()) throw new Error('Another Save or Restore is in progress');
    await core.call('doc.set', { name: 'herdr-state-lock', version: lock.version, value: { owner, until: Date.now() + 60000 } });
    locked = true;
  }
  const saved = await core.call('doc.get', { name: SNAPSHOT });
  let result;
  if (action === 'save') {
    const layout = await core.call('doc.get', { name: 'herdr-app' });
    const list = await core.call('terminal.list', {});
    for (const terminal of list.terminals) {
      if (terminal.address.includes('/')) continue;
      terminal.stateEnvironment = await agentEnvironment(terminal);
      if (await idleShell(terminal)) {
        terminal.labels = { ...terminal.labels };
        delete terminal.labels['herdr.state.agent'];
        delete terminal.labels['herdr.state.ref'];
        delete terminal.labels['herdr.voice.session'];
        delete terminal.labels['pi.session_file'];
      }
    }
    const { snapshot, warnings } = makeSnapshot(layout.value || { spaces: [] }, list.terminals, info.core.id);
    if (!snapshot.terminals.length) throw new Error('No open terminal panes to save; previous snapshot left intact');
    await leaseCheck();
    await core.call('doc.set', { name: SNAPSHOT, value: snapshot, version: saved.version });
    result = { action, savedAt: snapshot.savedAt, spaces: snapshot.layout.spaces.length,
      sessions: snapshot.terminals.filter(t => t.session).length, terminals: snapshot.terminals.length, warnings };
  } else if (action === 'restore') {
    result = await restore(core, validateSnapshot(saved.value, info.core.id), { check: leaseCheck });
  } else result = { action, savedAt: saved.value?.savedAt ?? null,
    sessions: saved.value?.terminals?.filter(t => t.session).length ?? 0 };
  console.log(JSON.stringify({ ...result, core: info.core.name }));
} catch (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
} finally {
  if (locked) {
    try {
      const lock = await core.call('doc.get', { name: 'herdr-state-lock' });
      if (lock.value?.owner === owner) await core.call('doc.set', { name: 'herdr-state-lock', version: lock.version, value: null });
    } catch (error) { console.error(`State lock release failed: ${error.message}`); process.exitCode = 1; }
  }
  core.close();
}
