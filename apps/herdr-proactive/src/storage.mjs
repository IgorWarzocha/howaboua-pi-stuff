import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openWorkspaceDatabase } from './database.mjs';

export const fingerprint = text => createHash('sha256').update(text).digest('hex');

export function storageRoot(coreId, env = process.env) {
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'herdr-proactive', fingerprint(coreId));
}

export function workspaceDirectory(coreId, root, env = process.env) {
  return join(storageRoot(coreId, env), 'workspaces', fingerprint(resolve(root)));
}

export function workspaceDatabasePath(coreId, root, env = process.env) {
  return join(workspaceDirectory(coreId, root, env), 'state.sqlite');
}

export function serviceDatabasePath(coreId, env = process.env) {
  return join(storageRoot(coreId, env), 'service.sqlite');
}

export function stateChangePath(coreId, root, env = process.env) {
  return join(workspaceDirectory(coreId, root, env), 'state.changed');
}

export async function notifyStateChange(coreId, root, env = process.env) {
  try { await atomicText(stateChangePath(coreId, root, env), randomUUID()); }
  catch (error) { throw new Error(`State was saved but observers could not be notified: ${error.message}`, { cause: error }); }
}

async function atomicText(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.proactive-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(value + '\n'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}

async function readOwner(path) {
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const match = /^(\d+) ([a-f0-9-]+)\n?$/.exec(text);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) {
    throw new Error(`Invalid or incomplete ownership file: ${path}`);
  }
  return { pid: Number(match[1]), token: match[2] };
}

async function lock(path, message) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      try { await file.writeFile(`${process.pid} ${token}\n`); }
      finally { await file.close(); }
      return async () => {
        const owner = await readOwner(path);
        if (owner?.token === token) await rm(path);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readOwner(path);
      // A creator may still be writing its PID. Never steal an unreadable lock.
      if (owner && processAlive(owner.pid)) throw new Error(message);
      if (owner) await rm(path, { force: true });
    }
  }
  throw new Error(message);
}

export function acquireLock(coreId, env = process.env) {
  const root = dirname(storageRoot(coreId, env));
  return lock(join(root, fingerprint(coreId).slice(0, 24) + '.lock'), 'A proactive service is already running for this Core');
}

function validateControl(value, path) {
  if (!value || value.version !== 1 || !value.policies || typeof value.policies !== 'object' || Array.isArray(value.policies)
    || !Object.hasOwn(value, 'reset')) throw new Error(`Unsupported proactive controls: ${path}`);
  if (Object.keys(value).some(key => !['version', 'policies', 'reset'].includes(key))) {
    throw new Error(`Controls cannot contain authored definitions: ${path}`);
  }
  const fields = new Set(['terminal', 'binding', 'snoozedUntil', 'manualRequest', 'acknowledgeRequest']);
  for (const record of Object.values(value.policies)) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !fields.has(key))) {
      throw new Error(`Unsupported policy controls: ${path}`);
    }
  }
  return value;
}

export async function readControl(coreId, root, env = process.env) {
  const path = workspaceDatabasePath(coreId, root, env);
  const database = openWorkspaceDatabase(path, { readOnly: true, create: false });
  try {
    const snapshot = database?.readControl() ?? { value: { version: 1, policies: {}, reset: null }, revision: 0 };
    return { ...snapshot, value: validateControl(snapshot.value, path), path };
  } finally { database?.close(); }
}

export function controlRevision(coreId, root, env = process.env) {
  const database = openWorkspaceDatabase(workspaceDatabasePath(coreId, root, env), { readOnly: true, create: false });
  try {
    return database?.readControlRevision() ?? 0;
  } finally { database?.close(); }
}

export async function editControl(coreId, root, edit, env = process.env) {
  const path = workspaceDatabasePath(coreId, root, env);
  const database = openWorkspaceDatabase(path);
  let revision;
  let snapshot;
  try {
    snapshot = database.editControl(value => {
      revision = database.readControlRevision();
      const replacement = edit(value);
      if (replacement && typeof replacement.then === 'function') throw new Error('Control edits must be synchronous');
      const next = validateControl(replacement ?? value, path);
      return next;
    });
  } finally { database.close(); }
  // Only committed controls notify the watcher; runtime/WAL writes never do.
  if (snapshot.revision !== revision) {
    try { await atomicText(join(workspaceDirectory(coreId, root, env), 'control.changed'), String(snapshot.revision)); }
    catch (error) { throw new Error(`Controls were saved but the service could not be notified: ${error.message}`, { cause: error }); }
  }
  return { ...snapshot, path };
}
