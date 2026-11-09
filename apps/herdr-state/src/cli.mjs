#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { Core } from './rpc.mjs';
import { SNAPSHOT, makeSnapshot, validateSnapshot } from './snapshot.mjs';
import { restore } from './restore.mjs';
import { inventory } from './inventory.mjs';
import { fleet, invoke, decode } from './fleet.mjs';

const core = new Core();

async function local(action, request = {}) {
  if (action === 'inventory') return inventory(core);
  const info = await core.call('server.status');
  if (action === 'launch-child') {
    // Launch from the actual parent's Core. Core then qualifies caller and
    // establishes its native reverse route and parent lifetime on the target.
    if (request.parent?.coreId !== info.core.id || !/^t[0-9a-z]+$/.test(request.parent?.address)) throw new Error('Invalid parent launch location');
    const parent = await core.call('terminal.get', { terminal: request.parent.address });
    if (parent.state !== 'live') throw new Error('Saved parent is no longer live');
    const routes = (await core.call('machine.list')).machines;
    if (!routes.some(m => m.id === request.targetCoreId)) throw new Error('Parent Core has no route to child Core; add that machine route before restoring');
    return core.call('terminal.run', { ...request.params, on: request.targetCoreId, caller: parent.address, no_parent: false });
  }
  if (!['local-save', 'local-restore', 'status'].includes(action)) throw new Error('Usage: herdr-state save|restore|status');
  if (action === 'status') {
    const saved = await core.call('doc.get', { name: SNAPSHOT });
    return { action, core: info.core.name, savedAt: saved.value?.savedAt ?? null,
      sessions: saved.value?.terminals?.filter(t => t.session).length ?? 0 };
  }
  const owner = randomUUID();
  const lockName = 'herdr-state-lock';
  const lock = await core.call('doc.get', { name: lockName });
  if (lock.value?.until > Date.now()) throw new Error('Another Save or Restore is in progress');
  await core.call('doc.set', { name: lockName, version: lock.version, value: { owner, until: Date.now() + 60000 } });
  const check = async () => {
    const current = await core.call('doc.get', { name: lockName });
    if (current.value?.owner !== owner || current.value.until < Date.now()) throw new Error('State operation lease expired; inspect terminals before retrying');
    await core.call('doc.set', { name: lockName, version: current.version, value: { owner, until: Date.now() + 60000 } });
  };
  try {
    const saved = await core.call('doc.get', { name: SNAPSHOT });
    if (action === 'local-save') {
      if (saved.value?.schema > 2) throw new Error('A newer State snapshot exists; update State before saving');
      const view = await inventory(core);
      const layout = await core.call('doc.get', { name: 'herdr-app' });
      const { snapshot, warnings } = makeSnapshot(layout.value || { spaces: [] }, view.terminals, info.core.id, view.machines);
      if (!snapshot.terminals.length) throw new Error('No open terminal panes or native conversations to save; previous snapshot left intact');
      await check();
      await core.call('doc.set', { name: SNAPSHOT, value: snapshot, version: saved.version });
      return { action: 'save', savedAt: snapshot.savedAt, spaces: snapshot.layout.spaces.length,
        sessions: snapshot.terminals.filter(t => t.session).length, terminals: snapshot.terminals.length, warnings };
    }
    const snapshot = validateSnapshot(saved.value, info.core.id);
    if (snapshot.id !== request.snapshotId) throw new Error('Snapshot changed during fleet restore; run Restore again');
    return await restore(core, snapshot, { check }, { ...request, coreId: info.core.id, coreVersion: info.version,
      launch: async (params, parent) => {
        if (!parent || parent.coreId === info.core.id) return core.call('terminal.run', {
          ...params, ...(parent ? { caller: parent.address, no_parent: false } : { no_parent: true }),
        });
        const made = await invoke(core, parent.coreId, 'launch-child', { parent, targetCoreId: info.core.id, params });
        // The source Core returns a qualified address. This owner uses local IDs.
        return { ...made, address: made.address.split('/').at(-1) };
      },
    });
  } finally {
    const current = await core.call('doc.get', { name: lockName });
    if (current.value?.owner === owner) await core.call('doc.set', { name: lockName, version: current.version, value: null });
  }
}

try {
  const action = process.argv[2];
  const result = ['save', 'restore'].includes(action)
    ? await fleet(core, action, process.argv[3] ? JSON.parse(process.argv[3]) : undefined, local)
    : await local(action, process.argv[3] ? decode(process.argv[3]) : {});
  console.log(JSON.stringify(result));
  if (result.reports?.some(report => report.error)) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
} finally { core.close(); }
