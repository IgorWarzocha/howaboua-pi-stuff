import { watch, readFileSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { readWorkspace, watchWorkspace } from './workspace-files.mjs';
import { readControl, editControl, controlRevision, workspaceDirectory, fingerprint } from './storage.mjs';
import { binding } from './config.mjs';

export class Catalog {
  constructor(core, coreId, env = process.env, changed = null) {
    this.core = core;
    this.coreId = coreId;
    this.env = env;
    this.changed = changed;
    this.workspaces = [];
    this.roots = new Map();
    this.snapshots = new Map();
    this.watchers = new Map();
    this.watchErrors = new Map();
    this.discoveryErrors = [];
  }

  rootForSpace(space) { return this.workspaces.find(item => item.id === space)?.root; }
  activitySpace(space) { return this.roots.get(this.rootForSpace(space))?.id ?? space; }

  async discover(terminals) {
    const layout = await this.core.call('doc.get', { name: 'herdr-app' });
    const spaces = new Map((layout.value?.spaces ?? []).map(space => [space.id, space]));
    for (const terminal of terminals) {
      const id = terminal.labels?.['herdr.space'];
      if (id && !spaces.has(id)) spaces.set(id, { id, folder: terminal.cwd });
    }
    this.discoveryErrors = [];
    this.workspaces = [];
    this.roots.clear();
    for (const space of spaces.values()) {
      const folder = space.folder || terminals.find(t => t.labels?.['herdr.space'] === space.id)?.cwd;
      if (!folder || !isAbsolute(folder)) continue;
      try {
        const root = await realpath(folder);
        const item = { id: space.id, root, name: space.name || folder };
        this.workspaces.push(item);
        if (!this.roots.has(root)) this.roots.set(root, item);
      } catch (error) { this.discoveryErrors.push({ space: space.id, path: folder, message: error.message }); }
    }
    for (const [root, close] of this.watchers) if (!this.roots.has(root)) {
      close(); this.watchers.delete(root); this.snapshots.delete(root);
      this.watchErrors.delete(root);
    }
    if (this.changed) for (const [root, workspace] of this.roots) if (!this.watchers.has(root)) {
      const changed = () => this.changed(workspace.id);
      const failed = error => {
        this.watchErrors.set(root, { space: workspace.id, path: root, message: error.message });
        changed();
      };
      try {
        const stopFiles = watchWorkspace(root, changed, failed);
        const directory = workspaceDirectory(this.coreId, root, this.env);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        let stopControl;
        try {
          const watcher = watch(directory, (_kind, name) => { if (name?.toString() === 'control.changed') changed(); });
          watcher.on('error', failed);
          stopControl = () => watcher.close();
        } catch (error) { stopFiles(); throw error; }
        this.watchers.set(root, () => { stopFiles(); stopControl(); });
      } catch (error) { failed(error); }
    }
  }

  async refresh(terminals, space = null, bindNew = false) {
    const root = space ? this.rootForSpace(space) : null;
    for (const [path, workspace] of this.roots) {
      if (space && path !== root) continue;
      try {
        const files = await readWorkspace(path, workspace.id);
        let control = await readControl(this.coreId, path, this.env);
        if (bindNew) {
          const missing = files.policies.filter(policy => policy.enabled && policy.allowTerminalInput && !control.value.policies[policy.id]?.binding);
          const ready = missing.map(policy => ({ policy, terminal: terminals.find(t => t.address === policy.terminal &&
            t.state === 'live' && t.reported && t.status && this.rootForSpace(t.labels?.['herdr.space']) === path && binding(t).pid) }))
            .filter(item => item.terminal);
          if (ready.length) control = await editControl(this.coreId, path, value => {
            for (const { policy, terminal } of ready) {
              const record = value.policies[policy.id] ??= {};
              if (!record.binding) { record.binding = binding(terminal); record.terminal = policy.terminal; }
            }
          }, this.env);
        }
        const policies = files.policies.map(policy => {
          const local = control.value.policies[policy.id] ?? {};
          const recipient = terminals.find(t => t.address === policy.terminal);
          const targetSpace = recipient?.labels?.['herdr.space'];
          return { ...policy, space: this.rootForSpace(targetSpace) === path ? targetSpace : workspace.id,
            activitySpace: workspace.id, binding: local.terminal === policy.terminal ? local.binding : null,
            snoozedUntil: local.snoozedUntil ?? 0, manualRequest: local.manualRequest ?? null,
            acknowledgeRequest: local.acknowledgeRequest ?? null,
            controlPath: control.path, controlRevision: control.revision };
        });
        this.snapshots.set(path, { policies, reset: control.value.reset,
          errors: files.errors.map(error => ({ ...error, space: workspace.id })) });
      } catch (error) {
        this.snapshots.set(path, { policies: [], errors: [{ space: workspace.id, path, message: error.message }] });
      }
    }
  }

  get policies() { return [...this.snapshots.values()].flatMap(snapshot => snapshot.policies); }
  get errors() { return [...this.discoveryErrors, ...this.watchErrors.values(), ...[...this.snapshots.values()].flatMap(snapshot => snapshot.errors)]; }
  get configuredWorkspaces() {
    return [...this.roots].map(([root, item]) => ({ ...item, policies: this.snapshots.get(root)?.policies ?? [] }));
  }

  // This last synchronous read is the acceptance boundary. No awaited work may
  // sit between it and starting terminal.send. Agents edit normal files; there
  // is no shared instruction document or cross-workspace authoring lock.
  current(policy, job = null) {
    try {
      if (controlRevision(this.coreId, policy.root, this.env) !== policy.controlRevision) return false;
      if (job && fingerprint(readFileSync(job.path, 'utf8')) !== job.revision) return false;
      return fingerprint(readFileSync(policy.path, 'utf8')) === policy.revision;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  close() { for (const close of this.watchers.values()) close(); this.watchers.clear(); }
}
