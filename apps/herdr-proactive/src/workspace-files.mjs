import { watch } from 'node:fs';
import { lstat, readdir, mkdir, open, rename, unlink, link } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { definitionId, definitionPolicy, readDefinition, writeDefinition } from './definitions.mjs';

const MAX_BYTES = 64 * 1024;
const revision = text => createHash('sha256').update(text).digest('hex');
const missing = error => error.code === 'ENOENT';
const policyHome = root => join(root, '.herdr', 'proactive');
const pulseHome = root => join(root, 'pulses');
const policyPath = (root, id) => join(policyHome(root), definitionId(id), 'PROACTIVE.md');
const pulsePath = (root, id) => join(pulseHome(root), definitionId(id), 'PULSE.md');
const policyId = (root, fileId) => `${createHash('sha256').update(resolve(root)).digest('hex').slice(0, 12)}--${fileId}`;

async function source(path) {
  let file;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Definition must be a regular file, not a symlink');
    if (stat.size > MAX_BYTES) throw new Error('Definition exceeds 64 KiB');
    file = await open(path, 'r');
    // Bounded read also protects against files growing after stat.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_BYTES) throw new Error('Definition exceeds 64 KiB');
    const text = buffer.subarray(0, size).toString('utf8');
    return { text, revision: revision(text), createdAt: stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs };
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  } finally { await file?.close(); }
}

async function folders(path, errors) {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Definition home must be a directory, not a symlink');
    return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch (error) {
    if (!missing(error)) errors.push({ path, message: error.message });
    return [];
  }
}

export async function readWorkspace(root, space) {
  root = resolve(root);
  const policies = [], errors = [], known = new Set(), byId = new Map();
  for (const id of await folders(policyHome(root), errors)) {
    const path = join(policyHome(root), id, 'PROACTIVE.md');
    try {
      const file = await source(path);
      if (!file) continue;
      definitionId(id);
      known.add(id);
      const policy = { ...readDefinition(file.text, 'policy'), id: policyId(root, id), fileId: id, space, root, path, revision: file.revision, jobs: [] };
      policies.push(policy);
      byId.set(id, policy);
    } catch (error) { errors.push({ path, message: error.message }); }
  }
  for (const id of await folders(pulseHome(root), errors)) {
    const path = join(pulseHome(root), id, 'PULSE.md');
    try {
      const file = await source(path);
      if (!file) continue;
      let owner;
      try { owner = definitionPolicy(file.text); }
      catch (error) {
        // An unrelated Pulse is not ours. Still report broken owned definitions.
        const candidates = [...file.text.matchAll(/^policy:\s*["']?([a-z0-9][-a-z0-9]{0,63})["']?(?:\s+#.*)?\s*$/gm)];
        if (candidates.some(match => known.has(match[1]))) throw error;
        continue;
      }
      if (!known.has(owner)) continue;
      definitionId(id);
      const job = { ...readDefinition(file.text, 'pulse'), id, path, revision: file.revision, createdAt: file.createdAt };
      byId.get(owner)?.jobs.push(job);
    } catch (error) { errors.push({ path, message: error.message }); }
  }
  return { policies, errors };
}

function conflict(path) {
  const error = new Error(`Definition changed on disk: ${path}. Reload before saving`);
  error.code = 'CONFLICT';
  error.path = path;
  return error;
}

function content(value, kind, policy) {
  // Strip machine-local state and catalog metadata before comparing edit intents.
  if (kind === 'pulse') return { name: value.name, policy, enabled: value.enabled, prompt: value.prompt, schedule: value.schedule };
  const { name, scope, terminal, enabled, mode, minMinutes, quietStart, quietEnd, allowTerminalInput, prompt } = value;
  return { name, scope, terminal, enabled, mode, minMinutes, quietStart, quietEnd, allowTerminalInput, prompt };
}

async function intent(path, kind, value, previous, owner) {
  const desired = value && content(value, kind, owner);
  const before = previous && content(previous, kind, owner);
  // Unedited jobs must not turn a policy save into a stale rewrite.
  if (desired && before && isDeepStrictEqual(desired, before)) return null;
  const current = await source(path);
  const expected = value ? value.revision : previous?.revision;
  if (current ? !expected || current.revision !== expected : expected != null) throw conflict(path);
  if (current && kind === 'pulse' && definitionPolicy(current.text) !== owner) throw conflict(path);
  if (!value) return current ? { path, expected, text: null } : null;
  const text = writeDefinition(desired, kind, current?.text);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`Definition exceeds 64 KiB: ${path}`);
  return current?.text === text ? null : { path, expected: current?.revision, text };
}

async function directories(root, path, create = false) {
  // Refuse symlinked instruction homes so saves cannot escape the workspace.
  let cursor = root;
  for (const part of relative(root, dirname(path)).split('/')) {
    cursor = join(cursor, part);
    if (create) {
      try { await mkdir(cursor); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    let stat;
    try { stat = await lstat(cursor); }
    catch (error) { if (!create && missing(error)) return; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Not a regular directory: ${cursor}`);
  }
}

async function applyIntents(root, intents) {
  // Validate every intent before writing any file. Multiple files are not atomic.
  for (const item of intents) {
    await directories(root, item.path);
    const current = await source(item.path);
    if (current?.revision !== item.expected) throw conflict(item.path);
  }
  for (const item of intents) {
    await directories(root, item.path, true);
    const current = await source(item.path);
    if (current?.revision !== item.expected) throw conflict(item.path);
    if (item.text === null) { await unlink(item.path); continue; }
    const temp = join(dirname(item.path), `.proactive-${randomUUID()}.tmp`);
    try {
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(item.text, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      const latest = await source(item.path);
      if (latest?.revision !== item.expected) throw conflict(item.path);
      // New files publish without replacement: a last-moment external creation
      // must not be overwritten. Existing-file updates use atomic rename.
      if (item.expected === undefined) {
        try { await link(temp, item.path); }
        catch (error) { if (error.code === 'EEXIST') throw conflict(item.path); throw error; }
      } else await rename(temp, item.path);
    } finally { await unlink(temp).catch(error => { if (!missing(error)) throw error; }); }
  }
}

export async function saveWorkspacePolicy(root, space, policy, previous) {
  root = resolve(root);
  const fileId = definitionId(policy.fileId ?? previous?.fileId ?? policy.id);
  if (previous && previous.id !== policy.id) throw new Error('Policy ID cannot change');
  if (previous?.fileId && previous.fileId !== fileId) throw new Error('Policy folder cannot change');
  if (!Array.isArray(policy.jobs)) throw new Error('Expected policy jobs');
  const intents = [], ids = new Set();
  const policyIntent = await intent(policyPath(root, fileId), 'policy', policy, previous, fileId);
  if (policyIntent) intents.push(policyIntent);
  for (const job of policy.jobs) {
    definitionId(job.id);
    if (ids.has(job.id)) throw new Error('Duplicate pulse ID');
    ids.add(job.id);
    const old = previous?.jobs?.find(item => item.id === job.id);
    const change = await intent(pulsePath(root, job.id), 'pulse', job, old, fileId);
    if (change) intents.push(change);
  }
  // A fresh catalog may contain agent-added jobs the editor has never seen.
  // Only explicit, revision-bearing removals can delete an instruction file.
  const removed = new Set();
  if (!Array.isArray(policy.removedJobs ?? [])) throw new Error('Expected removedJobs to be an array');
  for (const job of policy.removedJobs ?? []) {
    definitionId(job.id);
    if (ids.has(job.id) || removed.has(job.id)) throw new Error('Pulse cannot be both saved and removed or removed twice');
    removed.add(job.id);
    const change = await intent(pulsePath(root, job.id), 'pulse', null, job, fileId);
    if (change) intents.push(change);
  }
  await applyIntents(root, intents);
  const catalog = await readWorkspace(root, space);
  return { ...catalog, policy: catalog.policies.find(item => item.id === policyId(root, fileId)) };
}

export async function removeWorkspacePolicy(root, policy) {
  root = resolve(root);
  const fileId = definitionId(policy.fileId ?? policy.id);
  const intents = [];
  // Discover all currently owned pulses, including ones added by an agent since UI load.
  const catalog = await readWorkspace(root, policy.space);
  const current = catalog.policies.find(item => item.id === policyId(root, fileId));
  if (current && current.revision !== policy.revision) throw conflict(current.path);
  const errors = [];
  for (const id of await folders(pulseHome(root), errors)) {
    const path = join(pulseHome(root), id, 'PULSE.md');
    let file;
    try { file = await source(path); }
    catch (error) { if (policy.jobs?.some(item => item.id === id)) throw error; continue; }
    if (!file) continue;
    let owner;
    try { owner = definitionPolicy(file.text); }
    catch { continue; } // Ambiguous ownership is never permission to delete.
    if (owner !== fileId) continue;
    definitionId(id);
    const old = policy.jobs?.find(item => item.id === id) ?? { revision: file.revision };
    const change = await intent(path, 'pulse', null, old, fileId);
    if (change) intents.push(change);
  }
  if (errors.length) throw new Error(errors.map(item => `${item.path}: ${item.message}`).join('\n'));
  const change = await intent(policyPath(root, fileId), 'policy', null, policy, fileId);
  if (change) intents.push(change);
  await applyIntents(root, intents);
  return readWorkspace(root, policy.space);
}

export function watchWorkspace(root, onChange, onError) {
  root = resolve(root);
  const watchers = new Map();
  let closed = false, queued = false, refreshing = false, refreshAgain = false;
  const report = error => { if (!closed) onError(error); };
  function changed() {
    if (closed || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!closed) onChange(); });
  }
  async function refresh() {
    if (closed) return;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try {
      // Ancestor watches only notice creation/replacement of the two owned homes.
      const candidates = [
        { path: root, names: new Set(['.herdr', 'pulses']) },
        { path: join(root, '.herdr'), names: new Set(['proactive']) },
        { path: policyHome(root), recursive: true, document: 'PROACTIVE.md' },
        { path: pulseHome(root), recursive: true, document: 'PULSE.md' },
      ];
      for (const candidate of candidates) {
        let identity;
        try {
          const stat = await lstat(candidate.path);
          if (stat.isDirectory() && !stat.isSymbolicLink()) identity = `${stat.dev}:${stat.ino}`;
        }
        catch (error) { if (!missing(error)) report(error); }
        if (closed) break;
        const previous = watchers.get(candidate.path);
        if (previous && previous.identity !== identity) { previous.watcher.close(); watchers.delete(candidate.path); }
        if (!identity || watchers.has(candidate.path)) continue;
        try {
          const watcher = watch(candidate.path, { recursive: !!candidate.recursive }, (_event, filename) => {
            const name = filename?.toString();
            if (candidate.names && name && !candidate.names.has(name)) return;
            if (candidate.document && name) {
              const parts = name.split(/[\\/]/);
              if (parts.length > 2 || (parts.length === 2 && parts[1] !== candidate.document)) return;
            }
            changed();
            void refresh().catch(report);
          });
          watcher.on('error', error => { report(error); watcher.close(); watchers.delete(candidate.path); });
          watchers.set(candidate.path, { watcher, identity });
        } catch (error) { report(error); }
      }
    } finally {
      refreshing = false;
      if (refreshAgain) { refreshAgain = false; void refresh().catch(report); }
    }
  }
  void refresh().catch(report);
  return () => { closed = true; for (const { watcher } of watchers.values()) watcher.close(); watchers.clear(); };
}
