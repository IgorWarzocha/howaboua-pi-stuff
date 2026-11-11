import { sessionKey } from './snapshot.mjs';

export function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
export function decode(value) { return JSON.parse(Buffer.from(value || '', 'base64url').toString()); }

export async function invoke(core, on, action, payload = {}) {
  const result = await core.call('machine.exec', { on, argv: ['herdr-state', action, encode(payload)], timeout: 120 });
  if (result.timed_out || result.truncated) throw new Error('State helper timed out or returned incomplete data; inspect this machine before retrying');
  const stdout = Buffer.from(result.stdout || '', 'base64').toString();
  let report;
  try { report = JSON.parse(stdout); } catch { throw new Error('State helper returned no readable result; update State on this machine'); }
  if (result.code !== 0 || report.error) throw new Error(report.error || 'State helper failed');
  return report;
}

// One manual operation, direct inventories, machine-owned snapshots. Nothing is
// copied between native session stores and unavailable machines are never empty.
export async function fleet(core, action, names, local) {
  const info = await core.call('server.status');
  const catalog = (await core.call('machine.list')).machines;
  const targets = [{ id: info.core.id, name: info.core.name, on: null }, ...catalog.map(m => ({ ...m, on: m.id }))];
  const missing = (names || []).filter(name => name && !targets.some(t => t.name === name || t.id === name));
  const reports = missing.map(name => ({ core: name, error: 'Machine is not in this Core catalogue; add its route before restoring' }));
  const call = (target, operation, payload) => target.on === null ? local(operation, payload) : invoke(core, target.on, operation, payload);
  if (action === 'save') {
    reports.push(...await Promise.all(targets.map(async target => {
      try { return { core: target.name, ...await call(target, 'local-save', {}) }; }
      catch (error) { return { core: target.name, error: error.message }; }
    })));
    return { action, reports };
  }
  const inventories = [];
  await Promise.all(targets.map(async target => {
    try {
      const view = await call(target, 'inventory', {});
      if (view.protocol !== 2 || view.core.id !== target.id) throw new Error('State inventory identity/version mismatch; update State on this machine');
      inventories.push({ target, view });
    } catch (error) { reports.push({ core: target.name, error: error.message }); }
  }));
  inventories.sort((a, b) => targets.indexOf(a.target) - targets.indexOf(b.target));
  const inaccessible = reports.some(r => r.error);
  const occupied = new Map();
  const nodes = new Map();
  for (const { target, view } of inventories) {
    for (const terminal of view.terminals) {
      const session = terminal.reservedSession;
      if (session) occupied.set(sessionKey(session), { coreId: target.id, address: terminal.address });
    }
    if (!view.snapshot) { reports.push({ core: target.name, error: view.snapshotError || 'No saved snapshot on this Core' }); continue; }
    for (const saved of view.snapshot.terminals) nodes.set(`${target.id}/${saved.address}`, { target, view, saved });
  }
  const bindings = new Map();
  const visiting = new Set();
  const done = new Set();
  const recover = async key => {
    if (done.has(key)) return bindings.get(key);
    const node = nodes.get(key);
    if (!node) return null;
    if (visiting.has(key)) throw new Error('Saved parent cycle; no child launched');
    visiting.add(key);
    const { target, view, saved } = node;
    try {
      const existing = saved.session && occupied.get(sessionKey(saved.session));
      let parent = null;
      if (!existing && saved.parent) {
        parent = await recover(`${saved.parent.coreId}/${saved.parent.address}`);
        if (!parent) throw new Error('Saved parent is unavailable; child left untouched');
      }
      if (!existing && saved.session && inaccessible) throw new Error('Fleet inventory incomplete; native launch deferred to avoid duplicating an unreachable conversation');
      if (!existing && saved.parentUnavailable) throw new Error('Saved parent identity is unavailable; child left untouched');
      const result = await call(target, 'local-restore', { snapshotId: view.snapshot.id, only: saved.address, existing, parent });
      reports.push({ core: target.name, terminal: saved.address, ...result });
      const binding = result.binding;
      if (binding) {
        bindings.set(key, binding);
        if (saved.session) occupied.set(sessionKey(saved.session), binding);
      }
    } catch (error) { reports.push({ core: target.name, terminal: saved.address, error: error.message }); }
    finally { visiting.delete(key); done.add(key); }
    return bindings.get(key);
  };
  for (const key of nodes.keys()) await recover(key);
  return { action, reports };
}
