import { randomUUID } from 'node:crypto';
import { resumeArgv } from './resume.mjs';
import { ENV_KEYS, SHELL_NAMES } from './process.mjs';

export const SNAPSHOT = 'herdr-state';

export function terminalLeaves(node, result = []) {
  if (!node || typeof node !== 'object') throw new Error('Invalid layout node');
  if (typeof node.content?.terminal === 'string') result.push(node.content.terminal);
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) throw new Error('Invalid layout children');
    for (const child of node.children) terminalLeaves(child, result);
  }
  return result;
}

export function validateLayout(layout) {
  if (!layout || !Array.isArray(layout.spaces)) throw new Error('Invalid saved spaces');
  const ids = new Set();
  for (const space of layout.spaces) {
    if (typeof space.id !== 'string' || !Array.isArray(space.tabs) || ids.has(space.id)) throw new Error('Invalid saved space');
    ids.add(space.id);
    for (const tab of space.tabs) {
      if (typeof tab.id !== 'string' || ids.has(tab.id)) throw new Error('Invalid saved tab');
      ids.add(tab.id);
      terminalLeaves(tab.root);
    }
  }
  return layout;
}

export function sessionOf(terminal) {
  if (Object.hasOwn(terminal, 'nativeSession')) return terminal.nativeSession;
  const labels = terminal.labels || {};
  if (labels['herdr.state.ephemeral'] === '1') return null;
  if (labels['herdr.state.agent'] && labels['herdr.state.ref']) {
    try {
      const ref = JSON.parse(labels['herdr.state.ref']);
      if (resumeArgv(labels['herdr.state.agent'], ref)) return { agent: labels['herdr.state.agent'], ref };
    } catch { /* A malformed identity is reported as unavailable, never guessed. */ }
  }
  if (labels['pi.session_file']) {
    const ref = { kind: 'path', value: labels['pi.session_file'] };
    if (resumeArgv('pi', ref)) return { agent: 'pi', ref };
  }
  if (labels['herdr.voice.session']) {
    const ref = { kind: 'id', value: labels['herdr.voice.session'] };
    if (resumeArgv('pi', ref)) return { agent: 'pi', ref };
  }
  return null;
}

export function sessionKey(session) {
  return JSON.stringify([session.agent, session.nativeId ? 'id' : session.ref.kind, session.nativeId || session.ref.value]);
}

export function makeSnapshot(layout, terminals, coreId, machines = []) {
  validateLayout(layout);
  const byAddress = new Map(terminals.map(t => [t.address, t]));
  const saved = [];
  const warnings = [];
  const addresses = new Set(layout.spaces.flatMap(s => s.tabs.flatMap(t => terminalLeaves(t.root))));
  for (const terminal of terminals) if (!terminal.address.includes('/') && (sessionOf(terminal) || terminal.inspection === 'native')) addresses.add(terminal.address);
  // Local ancestors without panes still own a saved child's native lifetime.
  for (const address of addresses) {
    const parent = byAddress.get(address)?.parent;
    if (parent && !parent.includes('/')) addresses.add(parent);
  }
  for (const address of addresses) {
    if (address.includes('/')) { warnings.push(`${address}: remote pane belongs to its own Core snapshot`); continue; }
    const terminal = byAddress.get(address);
    if (!terminal || terminal.state !== 'live') { warnings.push(`${address}: no live terminal`); continue; }
    const session = sessionOf(terminal);
    const app = terminal.detectedAgent || terminal.status?.app || terminal.foreground?.name;
    if (!session && app && !SHELL_NAMES.has(app)) warnings.push(`${address}: ${app} has not reported an exact session; shell only`);
    let parent = null;
    if (terminal.parent) {
      const parts = terminal.parent.split('/');
      const machine = parts.length === 1 ? coreId : machines.find(m => m.id === parts[0] || m.name === parts[0])?.id;
      if (machine) parent = { coreId: machine, address: parts.at(-1) };
      else warnings.push(`${address}: parent machine identity unavailable; child cannot be reattached safely`);
    }
    saved.push({ address, cwd: terminal.foreground?.cwd || terminal.cwd, name: terminal.name, session,
      parent, parentUnavailable: Boolean(terminal.parent && !parent), outliveParent: !terminal.die_with_parent,
      env: terminal.stateEnvironment || {} });
  }
  return { snapshot: { schema: 2, id: randomUUID(), savedAt: new Date().toISOString(), coreId,
    layout: structuredClone(layout), terminals: saved, warnings: [...warnings] }, warnings };
}

export function validateSnapshot(value, coreId) {
  if (![1, 2].includes(value?.schema) || typeof value.id !== 'string' || value.coreId !== coreId || !Array.isArray(value.terminals)) {
    throw new Error('No compatible snapshot on this Core');
  }
  validateLayout(value.layout);
  if (!Array.isArray(value.warnings) || value.warnings.some(warning => typeof warning !== 'string')) throw new Error('Invalid saved warnings');
  const seen = new Set();
  for (const terminal of value.terminals) {
    if (typeof terminal.address !== 'string' || typeof terminal.cwd !== 'string' || seen.has(terminal.address)) throw new Error('Invalid saved terminal');
    seen.add(terminal.address);
    if (terminal.session !== null && !resumeArgv(terminal.session?.agent, terminal.session?.ref)) throw new Error('Invalid saved session');
    if (terminal.session?.nativeId !== undefined && (typeof terminal.session.nativeId !== 'string' || !terminal.session.nativeId)) throw new Error('Invalid saved native identity');
    if (terminal.parent && (typeof terminal.parent.coreId !== 'string' || !/^t[0-9a-z]+$/.test(terminal.parent.address))) throw new Error('Invalid saved parent');
    if (value.schema === 2 && (typeof terminal.outliveParent !== 'boolean' || typeof terminal.parentUnavailable !== 'boolean')) throw new Error('Invalid saved lifetime');
    if (!terminal.env || typeof terminal.env !== 'object' || Array.isArray(terminal.env)
      || Object.entries(terminal.env).some(([key, value]) => !ENV_KEYS.includes(key) || typeof value !== 'string' || value.includes('\0'))) {
      throw new Error('Invalid saved environment');
    }
  }
  return value;
}

// Merge rather than roll back: a Restore must not remove work opened after Save.
export function mergeLayout(current, saved, addresses, replaceable = new Set()) {
  validateLayout(current);
  validateLayout(saved);
  const merged = structuredClone(current);
  const replace = (node, currentTree = false) => {
    const address = node.content?.terminal;
    if (address && addresses.has(address) && (!currentTree || replaceable.has(address))) node.content.terminal = addresses.get(address);
    for (const child of node.children || []) replace(child, currentTree);
  };
  const restorable = node => {
    if (node.content?.terminal && !addresses.has(node.content.terminal)) return null;
    const copy = structuredClone(node);
    if (copy.children) {
      copy.children = copy.children.map(restorable).filter(Boolean);
      if (!copy.children.length) return null;
    }
    return copy;
  };
  for (const savedSpace of saved.spaces) {
    let space = merged.spaces.find(s => s.id === savedSpace.id);
    for (const savedTab of savedSpace.tabs) {
      const root = restorable(savedTab.root);
      if (!root) continue;
      if (!space) { space = { ...structuredClone(savedSpace), tabs: [] }; merged.spaces.push(space); }
      replace(root);
      const tab = space.tabs.find(t => t.id === savedTab.id);
      if (!tab) { space.tabs.push({ ...structuredClone(savedTab), root }); continue; }
      replace(tab.root, true);
      const present = new Set(terminalLeaves(tab.root));
      const appendMissing = node => {
        if (node.content?.terminal && !present.has(node.content.terminal)) {
          tab.root = { id: randomUUID(), type: 'row', children: [tab.root, { ...structuredClone(node), id: randomUUID() }] };
          present.add(node.content.terminal);
        } else for (const child of node.children || []) appendMissing(child);
      };
      appendMissing(root);
    }
  }
  return merged;
}
