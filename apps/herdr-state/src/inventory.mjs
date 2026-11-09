import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { idleShell, agentEnvironment } from './process.mjs';
import { linuxProcess, nativeAgent } from './ownership.mjs';
import { sessionOf, SNAPSHOT, validateSnapshot } from './snapshot.mjs';
import { resumeArgv } from './resume.mjs';

// Read the native header, not the transcript. Pi path and ID references must
// identify the same conversation, including copies on different machines.
export async function nativeIdentity(session) {
  if (!session || session.agent !== 'pi' || session.ref.kind !== 'path') return session;
  let file;
  let nativeId;
  try {
    file = await open(session.ref.value);
    const buffer = Buffer.alloc(16384);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const header = JSON.parse(buffer.subarray(0, bytesRead).toString().split('\n')[0]);
    if (header.type === 'session' && typeof header.id === 'string' && header.id) nativeId = header.id;
  } catch { /* Unreadable identities remain exact path references, never latest. */ }
  finally { await file?.close(); }
  if (nativeId && session.nativeId && nativeId !== session.nativeId) throw new Error('Saved native session file now identifies a different conversation; restore deferred');
  return nativeId ? { ...session, nativeId } : session;
}

async function nativeProcesses(terminal) {
  const result = [];
  const visit = async (pid, depth) => {
    if (depth > 24 || result.length > 128) throw new Error('terminal process tree is too large to inspect');
    const record = await linuxProcess(pid);
    if (!record) return;
    result.push(record);
    const children = await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8');
    for (const child of children.trim().split(/\s+/).filter(Boolean)) await visit(Number(child), depth + 1);
  };
  await visit(terminal.pid, 0);
  return result.filter(record => nativeAgent(record.argv));
}

export async function inspectTerminal(terminal) {
  terminal.idle = await idleShell(terminal);
  terminal.stateEnvironment = await agentEnvironment(terminal);
  const reported = sessionOf(terminal);
  terminal.nativeSession = null;
  if (terminal.idle || terminal.state !== 'live' || terminal.labels?.['herdr.state.ephemeral'] === '1') return terminal;
  let hinted;
  try {
    const processes = await nativeProcesses(terminal);
    const capturedOwner = terminal.labels?.['herdr.state.owner'];
    const verifiedOwner = processes.find(record => String(record.pid) === capturedOwner);
    const owner = verifiedOwner || processes[0];
    const agent = owner && nativeAgent(owner.argv);
    let session = agent && reported?.agent === agent && (!capturedOwner || verifiedOwner) ? reported : null;
    if (!session && owner) {
      // A resume argument can exclude a duplicate before capture loads, but
      // cannot prove the current selection after an in-process session switch.
      const argv = owner.argv;
      const flag = agent === 'pi' ? '--session' : null;
      const at = flag ? argv.indexOf(flag) : -1;
      if (at >= 0 && argv[at + 1]) {
        const value = argv[at + 1];
        const ref = { kind: value.includes('/') ? 'path' : 'id', value: value.includes('/') ? resolve(terminal.foreground?.cwd || terminal.cwd, value) : value };
        if (resumeArgv(agent, ref) && (ref.kind === 'path' || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))) hinted = { agent, ref };
      }
    }
    terminal.nativeSession = await nativeIdentity(session);
    terminal.detectedAgent = agent;
    terminal.inspection = owner ? 'native' : 'other';
  } catch { terminal.inspection = 'unknown'; }
  // A busy or uninspectable captured conversation is reserved conservatively.
  terminal.reservedSession = terminal.nativeSession || await nativeIdentity(reported || hinted);
  return terminal;
}

export async function inventory(core) {
  const info = await core.call('server.status');
  const catalog = await core.call('machine.list');
  const list = await core.call('terminal.list', {});
  const terminals = await Promise.all(list.terminals.filter(t => !t.address.includes('/')).map(inspectTerminal));
  const document = await core.call('doc.get', { name: SNAPSHOT });
  let snapshot = null;
  let snapshotError;
  if (document.value) {
    try {
      snapshot = structuredClone(validateSnapshot(document.value, info.core.id));
      for (const saved of snapshot.terminals) saved.session = await nativeIdentity(saved.session);
    } catch (error) { snapshotError = error.message; }
  }
  return { protocol: 2, core: info.core, machines: catalog.machines, terminals, snapshot, snapshotError };
}
