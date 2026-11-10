import { randomUUID } from 'node:crypto';
import { Catalog } from './catalog.mjs';
import { binding, validatePolicy } from './config.mjs';
import { saveWorkspacePolicy, removeWorkspacePolicy } from './workspace-files.mjs';
import { editControl, serviceDatabasePath, workspaceDatabasePath } from './storage.mjs';
import { openWorkspaceDatabase } from './database.mjs';
import { processAlive } from './state.mjs';
import { activitySummary, emptyActivity } from './activity.mjs';

export async function openCatalog(core, coreId, env, space = null) {
  const terminals = (await core.call('terminal.list')).terminals.filter(t => !t.address.includes('/'));
  const catalog = new Catalog(core, coreId, env);
  await catalog.discover(terminals);
  await catalog.refresh(terminals, space);
  return { catalog, terminals };
}

export async function status(core, coreId, env) {
  const { catalog, terminals } = await openCatalog(core, coreId, env);
  const serviceDatabase = openWorkspaceDatabase(serviceDatabasePath(coreId, env), { readOnly: true, create: false });
  let service;
  try { service = serviceDatabase?.readService().service ?? {}; }
  finally { serviceDatabase?.close(); }
  const runtime = {}, activity = {};
  for (const [root, workspace] of catalog.roots) {
    const path = workspaceDatabasePath(coreId, root, env);
    let database;
    try {
      database = openWorkspaceDatabase(path, { readOnly: true, create: false });
      Object.assign(runtime, database?.readRuntime().policies ?? {});
      const learned = database?.readActivity() ?? emptyActivity();
      const summary = activitySummary(learned, Date.now());
      for (const alias of catalog.workspaces.filter(item => item.root === root)) activity[alias.id] = summary;
    } catch (error) { catalog.discoveryErrors.push({ space: workspace.id, path, message: error.message }); }
    finally { database?.close(); }
  }
  return { service: { running: service.coreId === coreId && processAlive(service.pid),
    observedAt: service.observedAt ?? null, error: service.error ?? null },
  policies: catalog.policies, workspaces: catalog.workspaces, runtime, activity, errors: catalog.errors,
  terminals: terminals.filter(t => t.state === 'live' && t.reported && t.status).map(t => ({ address: t.address,
    name: t.name || t.title || t.address, space: t.labels?.['herdr.space'] ?? null, status: t.status.state })) };
}

export async function command(core, coreId, env, action, input) {
  const { catalog, terminals } = await openCatalog(core, coreId, env, input.space ?? null);
  const previous = catalog.policies.find(policy => policy.id === input.id);
  const space = input.space ?? previous?.space;
  const root = catalog.rootForSpace(space);
  if (!root) throw new Error('Choose an available workspace with a folder');
  if (action === 'configure') {
    if (typeof input.terminal !== 'string' || input.terminal.includes('/')) throw new Error('Choose a recipient on this machine');
    const needsBinding = !previous || previous.terminal !== input.terminal || !previous.binding || input.rebind === true;
    const terminal = needsBinding ? await core.call('terminal.get', { terminal: input.terminal }) : null;
    const policy = validatePolicy(input, previous, terminal);
    const saved = await saveWorkspacePolicy(root, space, policy, previous);
    await editControl(coreId, root, value => {
      const control = value.policies[saved.policy.id] ??= {};
      control.binding = policy.binding;
      control.terminal = policy.terminal;
    }, env);
    return { configured: saved.policy.id, path: saved.policy.path, jobs: saved.policy.jobs.map(job => ({ id: job.id, path: job.path })) };
  }
  if (action === 'reset') {
    await editControl(coreId, root, value => { value.reset = randomUUID(); }, env);
    return { reset: space, queued: true };
  }
  if (!previous) throw new Error('Unknown proactive policy');
  if (action === 'remove') {
    await removeWorkspacePolicy(root, previous);
    await editControl(coreId, root, value => { delete value.policies[previous.id]; }, env);
    return { removed: previous.id };
  }
  if (action === 'run' && (!previous.enabled || !previous.allowTerminalInput || !previous.prompt.trim())) {
    throw new Error('Enable the policy, acknowledge terminal input and enter check-in instructions before running');
  }
  const recipient = terminals.find(t => t.address === previous.terminal);
  if (action === 'bind' && (!recipient || recipient.state !== 'live' || !recipient.reported || !recipient.status ||
      recipient.labels?.['herdr.space'] !== previous.space || !binding(recipient).pid)) throw new Error('Choose a live status-reporting recipient');
  if (action === 'snooze' && (!Number.isSafeInteger(input.until) || input.until < 0 || input.until > 8640000000000000)) {
    throw new Error('Expected a UTC timestamp or zero to resume');
  }
  await editControl(coreId, root, value => {
    const control = value.policies[previous.id] ??= {};
    if (action === 'run') control.manualRequest = randomUUID();
    if (action === 'acknowledge') control.acknowledgeRequest = randomUUID();
    if (action === 'snooze') control.snoozedUntil = input.until;
    if (action === 'bind') { control.binding = binding(recipient); control.terminal = previous.terminal; }
  }, env);
  return { action, id: previous.id, queued: true };
}
