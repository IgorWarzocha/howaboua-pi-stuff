import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { idleShell, quote } from './process.mjs';
import { sessionKey, mergeLayout, terminalLeaves } from './snapshot.mjs';
import { inspectTerminal, nativeIdentity } from './inventory.mjs';

const launcher = fileURLToPath(new URL('./launch.mjs', import.meta.url));

export async function restore(core, snapshot, lease, options = {}) {
  const listing = await core.call('terminal.list', { all: false });
  // A core list also includes connected machines: only reconcile this machine here.
  const terminals = await Promise.all(listing.terminals.filter(t => !t.address.includes('/')).map(inspectTerminal));
  const byAddress = new Map(terminals.map(t => [t.address, t]));
  const addresses = new Map();
  const replaceable = new Set();
  const warnings = [...snapshot.warnings];
  let launched = 0, skipped = 0, shells = 0, parked = 0;
  const initial = await core.call('doc.get', { name: 'herdr-app' });
  const displayed = new Set((initial.value?.spaces || []).flatMap(s => s.tabs.flatMap(t => terminalLeaves(t.root))));
  const occupied = new Map();
  for (const terminal of terminals) {
    const session = terminal.reservedSession;
    if (session) occupied.set(sessionKey(session), terminal);
  }
  const claimed = new Set();
  let binding;
  const launch = options.launch || ((params) => core.call('terminal.run', params));
  for (const saved of snapshot.terminals.filter(t => !options.only || t.address === options.only)) {
    await lease.check();
    try {
      saved.session = await nativeIdentity(saved.session);
      const key = `${snapshot.id}:${saved.address}`;
      const receipt = terminals.find(t => t.labels?.['herdr.state.restored'] === key || t.labels?.['herdr.state.pending'] === key);
      const original = receipt || byAddress.get(saved.address);
      const identity = saved.session && sessionKey(saved.session);
      if (identity && claimed.has(identity)) { warnings.push(`${saved.address}: duplicate saved conversation skipped`); continue; }
      if (identity) claimed.add(identity);
      const existing = identity && (occupied.get(identity) || options.existing);
      if (existing) {
        // A session already displayed elsewhere stays there. Never replace newer work
        // in its old pane, or create a second view of the same conversation.
        binding = { coreId: existing.coreId || options.coreId || snapshot.coreId, address: existing.address };
        if (binding.coreId === snapshot.coreId && !displayed.has(existing.address)) addresses.set(saved.address, existing.address);
        skipped++;
        continue;
      }
      if (original?.labels?.['herdr.state.pending']) {
        warnings.push(`${saved.address}: previous launch was not confirmed; inspect this terminal before retrying`);
        if (!displayed.has(original.address)) addresses.set(saved.address, original.address);
        continue;
      }
      await access(saved.cwd);
      if (saved.session?.ref.kind === 'path') await access(saved.session.ref.value);
      if (!saved.session) {
        if (original) {
          if (!displayed.has(original.address)) addresses.set(saved.address, original.address);
          skipped++;
          binding = { coreId: snapshot.coreId, address: original.address };
        }
        else {
          const made = await launch({ cwd: saved.cwd, env: saved.env, keep: true, no_parent: true, no_notify: true,
            outlive_parent: saved.outliveParent ?? true, labels: { 'herdr.state.restored': key } }, options.parent);
          addresses.set(saved.address, made.address); shells++;
          binding = { coreId: snapshot.coreId, address: made.address };
          replaceable.add(saved.address);
        }
        continue;
      }
      if (original && !original.idle && !original.nativeSession) {
        warnings.push(`${saved.address}: existing busy or uninspectable terminal left untouched; native launch deferred`);
        continue;
      }
      const encoded = Buffer.from(JSON.stringify({ ...saved.session, key })).toString('base64url');
      const command = [process.execPath, launcher, encoded].map(quote).join(' ');
      // Never type into an existing shell: even a shell without child processes
      // can have a half-written command at its prompt.
      const made = await launch({
        argv: ['sh', '-c', `${command}; exec "\${SHELL:-/bin/sh}" -i`],
        cwd: saved.cwd, env: saved.env, keep: true, no_parent: true, no_notify: true,
        outlive_parent: saved.outliveParent ?? true,
        labels: { 'herdr.state.pending': key },
      }, options.parent);
      addresses.set(saved.address, made.address); launched++;
      binding = { coreId: snapshot.coreId, address: made.address };
      if (options.parent?.coreId !== undefined && options.parent.coreId !== snapshot.coreId
        && !saved.outliveParent && options.coreVersion === '0.1.18') {
        warnings.push(`${saved.address}: native parent restored; Core 0.1.18 did not stop cross-machine children after parent exit in validation. Close this child explicitly if its parent ends`);
      }
      if (!original) replaceable.add(saved.address);
      if (original && await idleShell(await core.call('terminal.get', { terminal: original.address }))) {
        // Park, do not kill: an unfinished input line remains recoverable with hc.
        await core.call('terminal.label', { terminal: original.address, labels: { 'herdr.space': '', 'herdr.tab': '' } });
        await core.call('terminal.keep', { terminal: original.address, keep: false });
        replaceable.add(original.address);
        addresses.set(original.address, made.address);
        parked++;
      } else if (original) {
        warnings.push(`${saved.address}: existing work left in place; saved conversation opened alongside it`);
      }
    } catch (error) { warnings.push(`${saved.address}: ${error.message}`); }
  }
  await lease.check();
  // Re-read and compare-and-swap so concurrent app changes are not overwritten.
  let layout;
  for (let attempt = 0; attempt < 3; attempt++) {
    const document = await core.call('doc.get', { name: 'herdr-app' });
    layout = mergeLayout(document.value || { spaces: [] }, snapshot.layout, addresses, replaceable);
    try {
      await core.call('doc.set', { name: 'herdr-app', version: document.version, value: layout });
      break;
    } catch (error) { if (error.kind !== 'conflict' || attempt === 2) throw error; }
  }
  // Keep Core adoption labels consistent with the document, including reused terminals.
  for (const space of layout.spaces) for (const tab of space.tabs) {
    const labelTree = async node => {
      const terminal = node.content?.terminal;
      if (terminal && [...addresses.values()].includes(terminal)) await core.call('terminal.label', {
        terminal, labels: { 'herdr.space': space.id, 'herdr.tab': tab.id },
      });
      for (const child of node.children || []) await labelTree(child);
    };
    await labelTree(tab.root);
  }
  return { action: 'restore', launched, shells, skipped, parked, warnings, savedAt: snapshot.savedAt, binding };
}
