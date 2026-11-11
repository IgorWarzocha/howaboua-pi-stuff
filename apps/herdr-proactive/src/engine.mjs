import { sameBinding } from './config.mjs';
import { recordEngagement } from './activity.mjs';
import { nextGeneric, nextJob } from './policy.mjs';
import { reconcileDefinitions } from './reconcile.mjs';
import { startDelivery, settleDelivery } from './delivery.mjs';

const rawStatus = terminal => terminal?.status?.state ?? null;
const seenTurn = terminal => {
  const label = terminal?.labels?.['herdr.seen'];
  return typeof label === 'string' && /^\d+$/.test(label) && Number.isSafeInteger(Number(label)) ? Number(label) : null;
};
const relevant = new Set(['created', 'restarted', 'removed', 'lost', 'finished', 'status', 'turn', 'labels', 'foreground']);

export class Engine {
  constructor(core, state, catalog, fatal) {
    this.core = core;
    this.state = state;
    this.catalog = catalog;
    this.fatal = fatal;
    this.terminals = new Map();
    this.seen = new Map();
    this.policies = [];
    this.timer = null;
    this.closed = false;
    this.chain = Promise.resolve();
    this.pending = 0;
    this.deliveries = new Set();
    this.pendingReloads = new Set();
  }

  filesChanged(space) {
    if (this.pendingReloads.has(space)) return;
    this.pendingReloads.add(space);
    this.enqueue(async () => { this.pendingReloads.delete(space); await this.configure(space); });
  }

  enqueue(action) {
    if (this.closed) return;
    if (++this.pending > 2048) { this.fatal(new Error('Event consumer fell behind. Restart to reconcile from Core.')); return; }
    this.chain = this.chain.then(async () => {
      if (!this.closed) await action();
    }).catch(error => this.fatal(error)).finally(() => { this.pending--; });
  }

  snapshot(snapshot) {
    this.terminals = new Map(snapshot.terminals.filter(t => !t.address.includes('/')).map(t => [t.address, t]));
    this.seen.clear();
    // Snapshots establish a baseline, never invented attention timestamps.
    for (const [address, terminal] of this.terminals) this.seen.set(address, seenTurn(terminal));
    this.seq = snapshot.seq;
    this.state.coveredAt = Date.now();
  }

  async configure(space = null) {
    await this.catalog.refresh([...this.terminals.values()], space, true);
    for (const workspace of this.catalog.configuredWorkspaces) {
      try { await this.state.loadSpaces([workspace]); }
      catch (error) {
        this.catalog.snapshots.set(workspace.root, { policies: [], errors: [{
          space: workspace.id, path: workspace.root, message: error.message,
        }] });
      }
    }
    this.policies = this.catalog.policies;
    reconcileDefinitions(this.state, this.catalog, Date.now());
    this.state.observedSpaces = new Set(this.policies.filter(p => p.enabled).map(p => p.activitySpace));
    for (const policy of this.policies) {
      const runtime = this.state.policy(policy.id);
      if ((this.seen.get(policy.terminal) ?? -1) > (runtime.dispatchTurn ?? Infinity)) runtime.pendingUnseen = false;
    }
    await this.state.flush(true);
    await this.state.save();
    await this.reconcile(space ? new Set([this.catalog.activitySpace(space)]) : null);
  }

  async notification(message) {
    this.state.coverage(Date.now());
    await this.state.flush();
    if (message.method === 'missed') {
      this.snapshot(message.params);
      await this.catalog.discover([...this.terminals.values()]);
      await this.configure();
      return;
    }
    if (message.method !== 'event') return;
    const event = message.params;
    if (event.seq <= this.seq) return;
    this.seq = event.seq;
    if (event.type === 'doc') {
      if (!event.machine && event.data.name === 'herdr-app') {
        await this.catalog.discover([...this.terminals.values()]);
        await this.configure();
      }
      return;
    }
    if (!relevant.has(event.type) || event.terminal?.includes('/')) return;
    const address = event.terminal;
    let activityChanged = false;
    if (event.type === 'removed') {
      this.terminals.delete(address);
      this.seen.delete(address);
    } else if (event.type === 'created' || event.type === 'restarted') {
      this.terminals.set(address, event.data);
      this.seen.set(address, seenTurn(event.data));
    } else {
      const terminal = this.terminals.get(address);
      if (!terminal) return;
      if (event.type === 'labels') {
        terminal.labels = event.data.labels;
        activityChanged = await this.attention(address, terminal);
      } else if (event.type === 'finished') {
        Object.assign(terminal, event.data, { state: 'finished', status: null, pid: null });
      } else if (event.type === 'lost') {
        Object.assign(terminal, event.data, { pid: null, foreground: null, status: null });
      } else if (event.type === 'foreground') terminal.foreground = event.data;
      else if (event.type === 'turn') terminal.turn = event.data.turn;
      else Object.assign(terminal, event.data);
    }
    const terminal = this.terminals.get(address);
    const unbound = terminal?.state === 'live' && terminal.reported && terminal.status &&
      this.policies.find(p => p.terminal === address && p.enabled && p.allowTerminalInput && !p.binding &&
        this.catalog.rootForSpace(terminal.labels?.['herdr.space']) === p.root);
    if (unbound) {
      // Initial availability can arrive after file discovery. Catalog still owns
      // the durable first binding and never replaces an existing process binding.
      await this.configure(unbound.space);
      return;
    }
    const affected = new Set(this.policies.filter(p => p.terminal === address).map(p => p.activitySpace));
    if (activityChanged) affected.add(this.catalog.activitySpace(this.terminals.get(address)?.labels?.['herdr.space']));
    if (affected.size) await this.reconcile(affected);
  }

  async attention(address, terminal) {
    const current = seenTurn(terminal);
    const previous = this.seen.get(address);
    // Mark-unread and a later restoration of the same turn are not new activity.
    if (current == null) return;
    this.seen.set(address, previous == null ? current : Math.max(previous, current));
    if (previous == null ? current === 0 : current <= previous) return;
    const space = this.catalog.activitySpace(terminal.labels?.['herdr.space']);
    if (!this.state.observedSpaces.has(space)) return;
    const now = Date.now();
    recordEngagement(this.state.activities.get(space), now);
    this.state.dirty.add(space);
    for (const policy of this.policies.filter(p => p.activitySpace === space)) {
      const runtime = this.state.policy(policy.id);
      runtime.lastEngagementAt = now;
      if (policy.terminal === address && current > (runtime.dispatchTurn ?? Infinity)) runtime.pendingUnseen = false;
    }
    await this.state.flush(true);
    await this.state.save();
    return true;
  }

  eligible(policy, runtime, now) {
    if (this.catalog.watchErrors.has(policy.root)) return 'Workspace file watcher failed. Restart the service';
    if (!policy.enabled || !policy.allowTerminalInput) return 'Paused';
    if (runtime.awaitingAck) return 'Inspect uncertain delivery, then acknowledge';
    if (runtime.inflight || this.deliveries.has(policy.terminal)) return 'Delivery in progress';
    if (policy.snoozedUntil > now) return 'Snoozed';
    const terminal = this.terminals.get(policy.terminal);
    if (!terminal || terminal.state !== 'live') return 'Recipient is unavailable';
    if (!sameBinding(policy.binding, terminal)) return 'Recipient process changed. Rebind explicitly';
    if (terminal.labels?.['herdr.space'] !== policy.space) return 'Recipient moved to another workspace';
    if (!terminal.reported) return 'Recipient does not report agent status';
    if (rawStatus(terminal) !== 'idle') return `Waiting for idle (reported ${rawStatus(terminal) ?? 'no status'})`;
    return null;
  }

  opportunity(policy, runtime, now) {
    const manual = policy.manualRequest && policy.manualRequest !== runtime.manualRequest;
    if (manual && policy.prompt.trim()) return { at: now, kind: 'manual', key: policy.manualRequest, prompt: policy.prompt };
    let first = null;
    for (const job of policy.jobs.filter(job => job.enabled)) {
      const cursor = Math.max(runtime.jobs[job.id] ?? 0, job.createdAt - 1, policy.enabledAt - 1);
      const at = nextJob(job, cursor);
      if (at != null && (!first || at < first.at)) first = { at, kind: 'job', key: job.id, prompt: job.prompt };
    }
    const activity = this.state.activities.get(policy.activitySpace);
    const sharedDispatch = Math.max(0, ...this.policies.filter(p => p.activitySpace === policy.activitySpace)
      .map(p => this.state.policy(p.id).lastDispatchAt));
    const generic = nextGeneric(policy, { ...runtime, enabledAt: policy.enabledAt,
      lastGenericAt: Math.max(runtime.lastGenericAt, sharedDispatch) }, activity, now);
    if (generic.at != null && (!first || generic.at < first.at)) {
      first = { at: generic.at, kind: 'generic', key: null, prompt: policy.prompt };
    }
    return first ?? { at: null, reason: generic.reason };
  }

  async reconcile(spaces = null) {
    clearTimeout(this.timer);
    this.timer = null;
    const now = Date.now();
    const before = JSON.stringify(this.state.value.policies);
    for (const policy of this.policies) {
      if (spaces && !spaces.has(policy.activitySpace)) continue;
      const runtime = this.state.policy(policy.id);
      const reason = this.eligible(policy, runtime, now);
      if (reason) {
        runtime.phase = runtime.awaitingAck ? 'uncertain' : runtime.inflight ? 'sending' : 'waiting';
        runtime.reason = reason;
        runtime.nextAt = policy.snoozedUntil > now ? policy.snoozedUntil : null;
        continue;
      }
      const next = this.opportunity(policy, runtime, now);
      runtime.nextAt = next.at;
      runtime.reason = next.reason ?? (next.at <= now ? 'Ready' : 'Scheduled');
      runtime.phase = next.at == null ? 'waiting' : 'scheduled';
      if (next.at != null && next.at <= now) await this.dispatch(policy, runtime, next);
    }
    if (before !== JSON.stringify(this.state.value.policies)) await this.state.save();
    const deadlines = this.policies.map(policy => this.state.policy(policy.id)).filter(runtime =>
      runtime.nextAt != null && ['scheduled', 'waiting'].includes(runtime.phase));
    const deadline = Math.min(Infinity, ...deadlines.map(runtime => runtime.nextAt));
    if (Number.isFinite(deadline) && !this.closed) {
      this.timer = setTimeout(() => this.enqueue(() => this.reconcile(new Set(this.policies.filter(policy => {
        const next = this.state.policy(policy.id).nextAt;
        return next != null && next <= Date.now();
      }).map(policy => policy.activitySpace)))), Math.min(2147483647, Math.max(1, deadline - Date.now())));
    }
  }

  async dispatch(policy, runtime, opportunity) {
    const terminal = await this.core.call('terminal.get', { terminal: policy.terminal });
    this.terminals.set(policy.terminal, terminal);
    const reason = this.eligible(policy, runtime, Date.now());
    if (reason) { runtime.phase = 'waiting'; runtime.reason = reason; runtime.nextAt = null; return; }
    this.deliveries.add(policy.terminal);
    const accepted = await startDelivery({ core: this.core, state: this.state, catalog: this.catalog,
      policy, runtime, opportunity, terminal,
      finished: (receipt, result, error) => this.enqueue(() => this.delivered(policy.id, receipt, result, error)) });
    if (!accepted) this.deliveries.delete(policy.terminal);
  }

  async delivered(id, receiptId, result, error) {
    const runtime = this.state.value.policies[id];
    const terminal = runtime?.inflight?.terminal;
    const settled = settleDelivery(runtime, receiptId, result, error, this.seen.get(terminal));
    this.deliveries.delete(settled.terminal);
    await this.state.save();
    if (!settled.deferred) {
      const policy = this.policies.find(item => item.id === id);
      await this.reconcile(policy ? new Set([policy.activitySpace]) : null);
    }
  }

  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.catalog.close();
    await this.chain;
    this.state.coverage(Date.now());
    await this.state.flush(true);
  }
}
