import { workspaceDirectory, workspaceDatabasePath, serviceDatabasePath, notifyStateChange } from './storage.mjs';
import { openWorkspaceDatabase } from './database.mjs';
import { emptyActivity, observeCoverage, pruneActivity } from './activity.mjs';

export { acquireLock, processAlive } from './storage.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function recover(runtime) {
  if (!runtime.inflight) return;
  // Durable intent is consumed, never retried after an unobserved process exit.
  const attempt = runtime.inflight;
  if (attempt.kind === 'manual') runtime.manualRequest = attempt.job;
  if (attempt.kind === 'job') runtime.jobs[attempt.job] = attempt.at;
  runtime.lastDispatchAt = attempt.at;
  runtime.lastGenericAt = attempt.at;
  runtime.pendingUnseen = true;
  const receipt = runtime.receipts.find(item => item.id === attempt.id);
  if (receipt) receipt.outcome = 'uncertain';
  runtime.inflight = null;
  runtime.phase = 'uncertain';
  runtime.awaitingAck = true;
  runtime.lastError = 'Service stopped during delivery. Inspect the agent, then acknowledge before continuing.';
}

export class State {
  constructor(coreId, env = process.env) {
    this.coreId = coreId;
    this.env = env;
    this.servicePath = serviceDatabasePath(coreId, env);
    this.serviceStore = { path: this.servicePath, database: null };
    this.workspaces = new Map();
    this.spaces = new Map();
    this.policyWorkspaces = new Map();
    this.serialized = new Map();
    this.activities = new Map();
    this.observedSpaces = new Set();
    this.dirty = new Set();
    this.coveredAt = Date.now();
    this.savedHour = Math.floor(this.coveredAt / 3600000);
    this.value = { version: 1, service: {}, policies: {}, resets: {} };
  }

  async load() {
    this.serviceStore.database ??= openWorkspaceDatabase(this.servicePath, { create: false });
    const metadata = this.serviceStore.database?.readService() ?? { service: {} };
    if (!object(metadata.service)) throw new Error('Unsupported proactive service state');
    this.value.service = metadata.service;
    this.serialized.set(this.servicePath, JSON.stringify(metadata));
  }

  async loadSpaces(workspaces) {
    for (const descriptor of workspaces) {
      const directory = workspaceDirectory(this.coreId, descriptor.root, this.env);
      let workspace = this.workspaces.get(directory);
      if (!workspace) {
        const path = workspaceDatabasePath(this.coreId, descriptor.root, this.env);
        const database = openWorkspaceDatabase(path, { create: false });
        try {
          const runtime = database?.readRuntime() ?? { version: 1, policies: {}, reset: null };
          if (runtime.version !== 1 || !object(runtime.policies) || !Object.hasOwn(runtime, 'reset')) {
            throw new Error(`Unsupported proactive runtime state: ${path}`);
          }
          const activity = database?.readActivity() ?? emptyActivity();
          if (!object(activity) || !Array.isArray(activity.days) || !Array.isArray(activity.months)) {
            throw new Error(`Unsupported proactive activity state: ${path}`);
          }
          workspace = { root: descriptor.root, directory, path, database, reset: runtime.reset, activity, ids: new Set(), spaces: new Set() };
          this.serialized.set(`${path}:runtime`, JSON.stringify(runtime));
          this.serialized.set(`${path}:activity`, JSON.stringify(activity));
          for (const [id, record] of Object.entries(runtime.policies)) {
            if (!object(record) || !object(record.jobs) || !Array.isArray(record.receipts)) {
              throw new Error(`Unsupported proactive policy state: ${path}`);
            }
            this.associate(id, workspace);
            recover(record);
            this.value.policies[id] = record;
          }
          pruneActivity(activity, Date.now());
          this.workspaces.set(directory, workspace);
        } catch (error) {
          database?.close();
          throw error;
        }
      }
      const previous = this.spaces.get(descriptor.id);
      if (previous && previous !== workspace) {
        previous.spaces.delete(descriptor.id);
        this.dirty.delete(descriptor.id);
      }
      workspace.spaces.add(descriptor.id);
      this.spaces.set(descriptor.id, workspace);
      this.activities.set(descriptor.id, workspace.activity);
      if (previous !== workspace) this.value.resets[descriptor.id] = workspace.reset;
      if (JSON.stringify(workspace.activity) !== this.serialized.get(`${workspace.path}:activity`)) this.dirty.add(descriptor.id);
      for (const policy of descriptor.policies) this.associate(policy.id, workspace);
    }
    // Catalog absence is not deletion: learned history and cursors remain private.
  }

  associate(id, workspace) {
    const previous = this.policyWorkspaces.get(id);
    if (previous && previous !== workspace) throw new Error(`Policy belongs to multiple workspaces: ${id}`);
    this.policyWorkspaces.set(id, workspace);
    workspace.ids.add(id);
  }

  coverage(now) {
    if (now - this.coveredAt < 15000) return;
    // Heartbeats are 15s apart. Longer gaps are unknown, not quiet hours.
    if (now - this.coveredAt <= 45000) {
      const observed = new Set();
      for (const [space, activity] of this.activities) {
        if (!this.observedSpaces.has(space) || observed.has(activity)) continue;
        observed.add(activity);
        observeCoverage(activity, this.coveredAt, now);
        this.dirty.add(space);
      }
    }
    this.coveredAt = now;
  }

  async writeChanged(store, kind, value) {
    const key = kind === 'service' ? store.path : `${store.path}:${kind}`;
    const serialized = JSON.stringify(value);
    if (this.serialized.get(key) === serialized) return;
    store.database ??= openWorkspaceDatabase(store.path);
    if (kind === 'service') store.database.writeService(value);
    else if (kind === 'runtime') store.database.writeRuntime(value);
    else store.database.writeActivity(value);
    this.serialized.set(key, serialized);
    if (kind !== 'service') await notifyStateChange(this.coreId, store.root, this.env);
  }

  async flush(force = false) {
    const now = Date.now();
    const hour = Math.floor(now / 3600000);
    if (!force && hour === this.savedHour) return;
    for (const space of this.dirty) {
      const workspace = this.spaces.get(space);
      const activity = this.activities.get(space);
      if (!workspace || !activity) continue;
      pruneActivity(activity, now);
      await this.writeChanged(workspace, 'activity', activity);
      // Explicit reset replaces the activity object in the public map.
      workspace.activity = activity;
      for (const alias of workspace.spaces) this.activities.set(alias, activity);
    }
    this.dirty.clear();
    this.savedHour = hour;
  }

  async save() {
    this.value.service.observedAt = Date.now();
    await this.writeChanged(this.serviceStore, 'service', { service: this.value.service });
    for (const workspace of this.workspaces.values()) {
      const policies = {};
      for (const id of workspace.ids) {
        const runtime = this.value.policies[id];
        if (runtime) policies[id] = runtime;
      }
      for (const space of workspace.spaces) {
        const token = this.value.resets[space];
        if (token !== undefined && token !== workspace.reset) {
          workspace.reset = token;
          for (const alias of workspace.spaces) this.value.resets[alias] = token;
        }
      }
      await this.writeChanged(workspace, 'runtime', { version: 1, policies, reset: workspace.reset });
    }
  }

  close() {
    const stores = [this.serviceStore, ...this.workspaces.values()];
    const errors = [];
    for (const store of stores) {
      try { store.database?.close(); }
      catch (error) { errors.push(error); }
      store.database = null;
    }
    if (errors.length) throw new AggregateError(errors, 'Could not close proactive state databases');
  }

  policy(id) {
    if (!this.policyWorkspaces.has(id)) throw new Error(`Policy has no configured workspace: ${id}`);
    return this.value.policies[id] ??= { phase: 'waiting', reason: 'Waiting for an opportunity',
      jobs: {}, lastGenericAt: 0, lastDispatchAt: 0, lastEngagementAt: 0, pendingUnseen: false,
      awaitingAck: false, inflight: null, receipts: [] };
  }
}
